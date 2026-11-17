mod backend;

fn provision_group_bot(
    directory: &std::path::Path,
    args: &[std::ffi::OsString],
) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    if args.len() != 5 || std::env::var("SOMBRA_OFFLINE_MAINTENANCE").as_deref() != Ok("1") {
        return Err(std::io::Error::other("Stop the Sombra service, set SOMBRA_OFFLINE_MAINTENANCE=1, then use --provision-group-bot GROUP_NAME BOT_NAME USERNAME ENV_OUTPUT").into());
    }
    let group = args[1].to_str().ok_or("Group name must be UTF-8")?;
    let name = args[2].to_str().ok_or("Bot name must be UTF-8")?;
    let username = args[3].to_str().ok_or("Username must be UTF-8")?;
    // Reserve the destination before any database mutation; never overwrite credentials.
    let output = std::path::PathBuf::from(&args[4]);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&output)?;
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        // Offline means no running process may hold this file-backed database.
        // The environment acknowledgment is mandatory; it is not an OS locking primitive.
        let database = directory.join("mines-db.json");
        if !database.is_file() {
            return Err("Existing Sombra database not found".into());
        }
        let mut store = backend::Backend::open(database).map_err(std::io::Error::other)?;
        let provisioned = store
            .provision_group_bot(group, name, username)
            .map_err(std::io::Error::other)?;
        let token = provisioned["token"]
            .as_str()
            .ok_or("Provisioning did not return credentials")?;
        write!(file,"SOMBRA_BOT_TOKEN={token}\nSOMBRA_API=http://127.0.0.1:3847/api\nHERMES_HOME=/home/hermes/.hermes\n")?;
        file.sync_all()?;
        println!(
            "Provisioned bot @{} in group {}",
            provisioned["bot"]["username"].as_str().unwrap_or(username),
            group
        );
        Ok(())
    })();
    if result.is_err() {
        drop(file);
        let _ = std::fs::remove_file(&output);
    }
    result
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::var_os("MINES_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("data"));
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if !args.is_empty() {
        if args[0] == "--provision-group-bot" {
            return provision_group_bot(&directory, &args);
        }
        return Err(std::io::Error::other("Unknown server argument").into());
    }
    let store =
        backend::Backend::open(directory.join("mines-db.json")).map_err(std::io::Error::other)?;
    backend::serve(store).await
}
