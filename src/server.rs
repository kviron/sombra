mod backend;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::var_os("MINES_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("data"));
    let store = backend::Backend::open(directory.join("mines-db.json"))
        .map_err(std::io::Error::other)?;
    backend::serve(store).await
}
