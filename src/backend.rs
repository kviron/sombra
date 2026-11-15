use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ring::{digest, pbkdf2};
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use std::{num::NonZeroU32, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
fn id()->String{uuid::Uuid::new_v4().to_string()}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()}
fn s<'a>(v:&'a Value,k:&str)->&'a str{v[k].as_str().unwrap_or("")}
fn arr(v:&Value)->Vec<Value>{v.as_array().cloned().unwrap_or_default()}
fn hash(password:&str,salt:&str)->String{let mut out=[0u8;32];pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),salt.as_bytes(),password.as_bytes(),&mut out);B64.encode(out)}
#[derive(Serialize, Deserialize)]
struct UserDto { id:String, name:String, bio:String, avatar:String, created_at:u64 }
fn public(u:&Value)->Value{serde_json::to_value(UserDto{id:s(u,"id").into(),name:s(u,"name").into(),bio:s(u,"bio").into(),avatar:s(u,"avatar").into(),created_at:u["created_at"].as_u64().unwrap_or(0)}).unwrap()}
#[derive(Serialize, Deserialize)]
struct UserRecord { id:String, name:String, email:String, salt:String, hash:String, bio:String, created_at:u64, version:u64 }
#[derive(Deserialize)]
struct CredentialsDto { email:String, password:String, #[serde(default)] name:String, #[serde(default)] device:String, #[serde(default)] remember_me:bool }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileDto { name:String, bio:String, #[serde(default)] avatar:Option<String> }
fn token_hash(token:&str)->String{B64.encode(digest::digest(&digest::SHA256,token.as_bytes()).as_ref())}
const YEAR_SECONDS:u64 = 365 * 24 * 60 * 60;
fn session_lifetime(remember_me:bool)->u64{if remember_me{YEAR_SECONDS}else{2592000}}
fn session_active(session:&Value,timestamp:u64)->bool{
 session["expires_at"].as_u64().unwrap_or(0)>timestamp &&
 (session["remember_me"].as_bool().unwrap_or(false) || session["last_seen"].as_u64().unwrap_or(0).saturating_add(604800)>timestamp)
}
pub struct Backend{db:Value,path:PathBuf,failures:u32,retry_at:u64,voice:Vec<Value>,signals:Vec<Value>,voice_seq:u64}
#[cfg(feature = "desktop")]
pub struct Store(pub Mutex<Backend>);
impl Backend{
 pub fn open(path:PathBuf)->Result<Self,String>{
  std::fs::create_dir_all(path.parent().ok_or("Invalid path")?).map_err(|e|e.to_string())?;
  let db:Value=if path.exists(){serde_json::from_slice(&std::fs::read(&path).map_err(|e|e.to_string())?).map_err(|e|format!("Database unreadable: {e}"))?}else{json!({"users":[],"groups":[],"dialogs":[],"messages":[],"secret":format!("{}{}",id(),id())})};
  if !["users","groups","dialogs","messages"].iter().all(|k|db[*k].is_array())||s(&db,"secret").len()<32{return Err("Invalid database; refusing to overwrite".into())}
  let mut b=Self{db,path,failures:0,retry_at:0,voice:Vec::new(),signals:Vec::new(),voice_seq:0};
  if b.db["sessions"].is_null(){b.db["sessions"]=json!([]);}
  if !b.db["sessions"].is_array(){return Err("Invalid sessions".into())}
  for key in ["stickers","friends","bots"] { if b.db[key].is_null(){b.db[key]=json!([]);} if !b.db[key].is_array(){return Err("Invalid collection".into())} }
  b.db["schema_version"]=json!(3);
  for user in b.db["users"].as_array_mut().unwrap(){if user["created_at"].is_null(){user["created_at"]=json!(now());user["bio"]=json!("");}}
  b.save()?;
  if arr(&b.db["users"]).is_empty(){
   let password=format!("Mines-{}",&id()[..18]);let u=b.new_user("HollyWood","owner@mines.local",&password);let uid=s(&u,"id").to_string();b.db["users"].as_array_mut().unwrap().push(u);
   let channels:Vec<_>=["text","id","games","help","⚓ Команда 1","Команда 2"].iter().enumerate().map(|(i,n)|json!({"id":id(),"name":n,"kind":if i<4{"text"}else{"voice"}})).collect();
   b.db["groups"].as_array_mut().unwrap().push(json!({"id":id(),"name":"LordDevil","owner":uid,"invite":id(),"members":[uid],"channels":channels}));
   std::fs::write(b.path.with_file_name("FIRST-USER.txt"),format!("Email: owner@mines.local\nPassword: {password}\n")).map_err(|e|e.to_string())?;b.save()?;
  }Ok(b)
 }
 fn new_user(&self,name:&str,email:&str,password:&str)->Value{let salt=id();serde_json::to_value(UserRecord{id:id(),name:name.into(),email:email.into(),hash:hash(password,&salt),salt,bio:String::new(),created_at:now(),version:0}).unwrap()}
 fn save(&self)->Result<(),String>{let tmp=self.path.with_extension("tmp");std::fs::write(&tmp,serde_json::to_vec_pretty(&self.db).unwrap()).map_err(|e|e.to_string())?;std::fs::rename(tmp,&self.path).map_err(|e|e.to_string())}
 fn token(&mut self,u:&Value,device:&str,remember_me:bool)->Result<String,String>{
  let token=format!("{}{}",id(),id());let timestamp=now();
  let sessions=self.db["sessions"].as_array_mut().unwrap();
  sessions.retain(|x|session_active(x,timestamp));
  sessions.push(json!({"id":id(),"user_id":u["id"],"token_hash":token_hash(&token),"device":device.chars().take(120).collect::<String>(),"created_at":timestamp,"last_seen":timestamp,"remember_me":remember_me,"expires_at":timestamp+session_lifetime(remember_me)}));
  self.save()?;Ok(token)
 }
 fn authenticate(&self,token:&str)->Result<Value,String>{
  let session=arr(&self.db["sessions"]).into_iter().find(|x|x["token_hash"]==token_hash(token)&&session_active(x,now())).ok_or("AUTH_REQUIRED")?;
  arr(&self.db["users"]).into_iter().find(|u|u["id"]==session["user_id"]).ok_or("AUTH_REQUIRED".into())
 }
 fn allowed(&self,uid:&str,cid:&str)->bool{arr(&self.db["groups"]).iter().any(|g|arr(&g["members"]).contains(&json!(uid))&&arr(&g["channels"]).iter().any(|c|c["id"]==cid))||arr(&self.db["dialogs"]).iter().any(|d|d["id"]==cid&&arr(&d["members"]).contains(&json!(uid)))}
 fn voice_action(&mut self,v:&Value,uid:&str,session:&str)->Result<Value,String>{
  self.voice.retain(|p|p["seen"].as_u64().unwrap_or(0)+20>now());
  self.signals.retain(|p|p["time"].as_u64().unwrap_or(0)+30>now());
  let op=s(v,"op");let client=s(v,"client");let room=s(v,"room");
  if client.len()<16||client.len()>64{return Err("Некорректное подключение".into())}
  if !self.allowed(uid,room)||!arr(&self.db["groups"]).iter().any(|g|arr(&g["channels"]).iter().any(|c|c["id"]==room&&c["kind"]=="voice")){return Err("Нет доступа к голосовой комнате".into())}
  let owns=self.voice.iter().any(|p|p["client"]==client&&p["session"]==session&&p["room"]==room);
  if op=="voice_join"{
   if self.voice.iter().any(|p|p["client"]==client&&!owns){return Err("Подключение уже используется".into())}
   if self.voice.iter().filter(|p|p["room"]==room).count()>=8&&!owns{return Err("Комната заполнена (8 участников)".into())}
   self.voice.retain(|p|p["client"]!=client);
   self.voice.push(json!({"client":client,"user":uid,"session":session,"room":room,"seen":now()}));
  }else if op=="voice_leave"{
   self.voice.retain(|p|!(p["client"]==client&&p["session"]==session));return Ok(json!({}));
  }else if !owns{return Err("Соединение завершено. Войдите в комнату снова.".into())}
  if op=="voice_signal"{
   let target=s(v,"target");let payload=&v["payload"];
   if payload.to_string().len()>65536||!self.voice.iter().any(|p|p["client"]==target&&p["room"]==room){return Err("Участник отключился".into())}
   if self.signals.iter().filter(|p|p["from"]==client).count()>256{return Err("Слишком много сигналов".into())}
   self.voice_seq+=1;self.signals.push(json!({"id":self.voice_seq,"from":client,"target":target,"payload":payload,"time":now()}));return Ok(json!({}));
  }
  for p in &mut self.voice{if p["client"]==client{p["seen"]=json!(now());}}
  let after=v["after"].as_u64().unwrap_or(0);
  let peers:Vec<_>=self.voice.iter().filter(|p|p["room"]==room).map(|p|json!({"client":p["client"],"user":p["user"]})).collect();
  let signals:Vec<_>=self.signals.iter().filter(|p|p["target"]==client&&p["id"].as_u64().unwrap_or(0)>after).cloned().collect();
  let ice:Value=std::env::var("MINES_ICE_SERVERS").ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or(json!([]));
  Ok(json!({"peers":peers,"signals":signals,"cursor":self.voice_seq,"iceServers":ice}))
 }
 fn state(&self,u:&Value)->Value{let uid=s(u,"id");json!({"me":public(u),"email":u["email"],"groups":arr(&self.db["groups"]).into_iter().filter(|g|arr(&g["members"]).contains(&json!(uid))).collect::<Vec<_>>(),"dialogs":arr(&self.db["dialogs"]).into_iter().filter(|d|arr(&d["members"]).contains(&json!(uid))).collect::<Vec<_>>(),"messages":arr(&self.db["messages"]).into_iter().filter(|m|self.allowed(uid,s(m,"channel"))).collect::<Vec<_>>(),"stickers":arr(&self.db["stickers"]).into_iter().filter(|x|x["owner"]==uid || arr(&self.db["messages"]).iter().any(|m|m["sticker"]==x["id"] && self.allowed(uid,s(m,"channel")))).collect::<Vec<_>>(),"friends":arr(&self.db["friends"]).into_iter().filter(|x|x["from"]==uid||x["to"]==uid).collect::<Vec<_>>(),"bots":arr(&self.db["bots"]).into_iter().filter(|x|self.allowed(uid,s(x,"channel"))).map(|x|json!({"id":x["id"],"name":x["name"],"channel":x["channel"],"owner":x["owner"]})).collect::<Vec<_>>(),"users":arr(&self.db["users"]).iter().map(public).collect::<Vec<_>>()})}
 pub fn request(&mut self,v:Value)->Result<Value,String>{let prev=self.db.clone();let result=self.action(v);if result.is_err(){self.db=prev}result}
 fn action(&mut self,v:Value)->Result<Value,String>{
  let op=s(&v,"op");
  if op=="login"||op=="register"{
   if self.retry_at>now(){return Err("Слишком много попыток. Подождите минуту".into())}
   let dto:CredentialsDto=serde_json::from_value(v.clone()).map_err(|_|"Проверьте данные входа")?;let email=dto.email.trim().to_lowercase();let password=dto.password.as_str();if email.len()>254||!email.contains('@')||password.len()<8||password.len()>256{return Err("Проверьте почту и пароль (8–256 символов)".into())}
   let u=if op=="register"{let name=dto.name.trim();if name.chars().count()<2||name.chars().count()>32{return Err("Имя: от 2 до 32 символов".into())}if arr(&self.db["users"]).iter().any(|u|u["email"]==email){return Err("Эта почта уже зарегистрирована".into())}let u=self.new_user(name,&email,password);self.db["users"].as_array_mut().unwrap().push(u.clone());u}else{
    let candidate=arr(&self.db["users"]).into_iter().find(|u|u["email"]==email);let salt=candidate.as_ref().map(|u|s(u,"salt")).unwrap_or("unknown-account");let expected=candidate.as_ref().and_then(|u|B64.decode(s(u,"hash")).ok()).unwrap_or(vec![0;32]);
    if pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),salt.as_bytes(),password.as_bytes(),&expected).is_err(){self.failures+=1;if self.failures>=8{self.retry_at=now()+60;self.failures=0}return Err("Неверная почта или пароль".into())}self.failures=0;candidate.ok_or("Неверная почта или пароль")?
   };return Ok(json!({"token":self.token(&u,&dto.device,dto.remember_me)?,"user":public(&u)}))
  }
  if op=="bot_poll"||op=="bot_message" {
   let bot=arr(&self.db["bots"]).into_iter().find(|b|b["token_hash"]==token_hash(s(&v,"bot_token"))).ok_or("AUTH_REQUIRED")?;
   let channel=s(&bot,"channel");
   if op=="bot_poll" {return Ok(json!({"messages":arr(&self.db["messages"]).into_iter().filter(|m|m["channel"]==channel).collect::<Vec<_>>()}))}
   let text=s(&v,"text").trim();if text.is_empty()||text.chars().count()>2000{return Err("Сообщение: 1–2000 символов".into())}
   self.db["messages"].as_array_mut().unwrap().push(json!({"id":id(),"channel":channel,"user":bot["id"],"bot_name":bot["name"],"text":text,"time":now()}));self.save()?;return Ok(json!({"ok":true}))
  }
  let u=self.authenticate(s(&v,"token"))?;let uid=s(&u,"id");
  let current=token_hash(s(&v,"token"));
  let session=self.db["sessions"].as_array_mut().unwrap().iter_mut().find(|x|x["token_hash"]==current).unwrap();
  if session["last_seen"].as_u64().unwrap_or(0)+60<now(){session["last_seen"]=json!(now());self.save()?;}
  if op.starts_with("voice_"){return self.voice_action(&v,uid,&current)}
  match op{
   "me"=>return Ok(json!({"user":public(&u),"email":u["email"]})),
   "sessions"=>return Ok(json!(arr(&self.db["sessions"]).iter().filter(|x|x["user_id"]==uid&&session_active(x,now())).map(|x|json!({"id":x["id"],"device":x["device"],"created_at":x["created_at"],"last_seen":x["last_seen"],"expires_at":x["expires_at"],"current":x["token_hash"]==current})).collect::<Vec<_>>())),
   "revoke_session"=>{let sessions=self.db["sessions"].as_array_mut().unwrap();if !sessions.iter().any(|x|x["user_id"]==uid&&x["id"]==v["session_id"]){return Err("Сессия не найдена".into())}sessions.retain(|x|!(x["user_id"]==uid&&x["id"]==v["session_id"]));},
   "logout_all"=>self.db["sessions"].as_array_mut().unwrap().retain(|x|x["user_id"]!=uid),
   "update_profile"=>{let dto:ProfileDto=serde_json::from_value(v["profile"].clone()).map_err(|_|"Некорректный профиль")?;if let Some(ref avatar)=dto.avatar {if !avatar.is_empty() {let (header,data)=avatar.split_once(',').ok_or("Предпросмотр аватарки")?;if !["data:image/png;base64","data:image/jpeg;base64","data:image/webp;base64"].contains(&header)||data.len()>700_000||base64::engine::general_purpose::STANDARD.decode(data).is_err(){return Err("Выберите изображение PNG, JPEG или WebP до 500 КБ".into())}}}let name=dto.name.trim();if !(2..=32).contains(&name.chars().count())||dto.bio.chars().count()>190{return Err("Имя: 2–32 символа, о себе: до 190".into())}let user=self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap();user["name"]=json!(name);user["bio"]=json!(dto.bio);if let Some(avatar)=dto.avatar{user["avatar"]=json!(avatar)}},
   "change_email"=>{
    let email=s(&v,"email").trim().to_lowercase();
    let parts:Vec<_>=email.split('@').collect();
    if email.len()>254||parts.len()!=2||parts[0].is_empty()||!parts[1].contains('.')||parts[1].starts_with('.')||parts[1].ends_with('.')||email.chars().any(char::is_whitespace){return Err("Введите корректную электронную почту".into())}
    let expected=B64.decode(s(&u,"hash")).map_err(|_|"Invalid password hash")?;
    pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),s(&u,"salt").as_bytes(),s(&v,"current_password").as_bytes(),&expected).map_err(|_|"Неверный текущий пароль")?;
    if arr(&self.db["users"]).iter().any(|x|x["id"]!=uid&&x["email"]==email){return Err("Эта почта уже зарегистрирована".into())}
    self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap()["email"]=json!(email);
   },
   "change_password"=>{let password=s(&v,"password");if !(8..=256).contains(&password.len()){return Err("Пароль: 8–256 символов".into())}let expected=B64.decode(s(&u,"hash")).map_err(|_|"Invalid password hash")?;pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),s(&u,"salt").as_bytes(),s(&v,"current_password").as_bytes(),&expected).map_err(|_|"Неверный текущий пароль")?;let salt=id();let user=self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap();user["salt"]=json!(salt);user["hash"]=json!(hash(password,&salt));self.db["sessions"].as_array_mut().unwrap().retain(|x|x["user_id"]!=uid);},
   "state"=>return Ok(self.state(&u)),
   "logout"=>self.db["sessions"].as_array_mut().unwrap().retain(|x|x["token_hash"]!=current),
   "create_group"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>60{return Err("Название: 1–60 символов".into())}let group=json!({"id":id(),"name":name,"owner":uid,"invite":id(),"members":[uid],"channels":[{"id":id(),"name":"общий","kind":"text"},{"id":id(),"name":"Гостиная","kind":"voice"}]});self.db["groups"].as_array_mut().unwrap().push(group.clone());self.save()?;return Ok(group)},
   "join_group"=>{let g=self.db["groups"].as_array_mut().unwrap().iter_mut().find(|g|g["invite"]==s(&v,"invite")).ok_or("Приглашение не найдено")?;if !arr(&g["members"]).contains(&json!(uid)){g["members"].as_array_mut().unwrap().push(json!(uid));}let joined=g.clone();self.save()?;return Ok(joined)},
   "invite_group_member"=>{
    let group_index=self.db["groups"].as_array().unwrap().iter()
     .position(|g|g["id"]==v["group"]&&g["owner"]==uid)
     .ok_or("Участников приглашает владелец группы")?;
    let email=s(&v,"email").trim().to_lowercase();
    let (local,domain)=email.split_once('@').ok_or("Введите корректную электронную почту")?;
    if email.len()>254||local.is_empty()||domain.is_empty()||domain.contains('@')||email.chars().any(char::is_whitespace){
     return Err("Введите корректную электронную почту".into())
    }
    let invited_user=self.db["users"].as_array().unwrap().iter()
     .find(|user|user["email"]==email)
     .ok_or("Аккаунт с этой почтой не найден")?["id"].clone();
    let members=self.db["groups"][group_index]["members"].as_array_mut().unwrap();
    if members.contains(&invited_user){return Ok(json!({"ok":true}))}
    members.push(invited_user);
   },
   "update_channel"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название канала: 1–40 символов".into())}let g=self.db["groups"].as_array_mut().unwrap().iter_mut().find(|g|g["id"]==v["group"]&&g["owner"]==uid).ok_or("Каналы редактирует владелец группы")?;let channel=g["channels"].as_array_mut().unwrap().iter_mut().find(|c|c["id"]==v["channel"]).ok_or("Канал не найден")?;channel["name"]=json!(name);let updated=channel.clone();self.save()?;return Ok(updated)},
   "create_channel"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название канала: 1–40 символов".into())}let g=self.db["groups"].as_array_mut().unwrap().iter_mut().find(|g|g["id"]==v["group"]&&g["owner"]==uid).ok_or("Каналы создаёт владелец группы")?;let channel=json!({"id":id(),"name":name,"kind":if v["kind"]=="voice"{"voice"}else{"text"}});g["channels"].as_array_mut().unwrap().push(channel.clone());self.save()?;return Ok(channel)},
   "create_dialog"=>{let mut members=vec![json!(uid)];for member in arr(&v["members"]){if !arr(&self.db["users"]).iter().any(|u|u["id"]==member){return Err("Пользователь не найден".into())}if !members.contains(&member){members.push(member)}}if members.len()<2||members.len()>10{return Err("Выберите от 1 до 9 собеседников".into())}if members.len()==2{if let Some(d)=arr(&self.db["dialogs"]).iter().find(|d|arr(&d["members"]).len()==2&&members.iter().all(|m|arr(&d["members"]).contains(m))){return Ok(d.clone())}}let name=s(&v,"name").trim();if name.chars().count()>60{return Err("Название слишком длинное".into())}let d=json!({"id":id(),"name":if name.is_empty(){"Личный диалог"}else{name},"members":members,"owner":uid});self.db["dialogs"].as_array_mut().unwrap().push(d.clone());self.save()?;return Ok(d)},
   "friend_request"=>{
    let target=s(&v,"user");if target==uid||!arr(&self.db["users"]).iter().any(|x|x["id"]==target){return Err("Выберите пользователя".into())}
    if arr(&self.db["friends"]).iter().any(|x|(x["from"]==uid&&x["to"]==target)||(x["from"]==target&&x["to"]==uid)){return Err("Заявка или дружба уже существует".into())}
    self.db["friends"].as_array_mut().unwrap().push(json!({"id":id(),"from":uid,"to":target,"accepted":false}));
   },
   "friend_accept"|"friend_remove"=>{
    let rows=self.db["friends"].as_array_mut().unwrap();let i=rows.iter().position(|x|x["id"]==v["id"]&&(x["from"]==uid||x["to"]==uid)).ok_or("Заявка не найдена")?;
    if op=="friend_accept" {if rows[i]["to"]!=uid{return Err("Заявку принимает получатель".into())}rows[i]["accepted"]=json!(true);}else{rows.remove(i);}
   },
   "create_bot"=>{
    let channel=s(&v,"channel");if !arr(&self.db["groups"]).iter().any(|g|g["owner"]==uid&&arr(&g["channels"]).iter().any(|c|c["id"]==channel)){return Err("Бота подключает владелец группы".into())}
    let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>32{return Err("Имя бота: 1–32 символа".into())}
    if arr(&self.db["bots"]).iter().filter(|b|b["channel"]==channel).count()>=5{return Err("Не более 5 ботов в комнате".into())}
    let token=format!("{}{}",id(),id());let bot=json!({"id":id(),"name":name,"channel":channel,"owner":uid,"token_hash":token_hash(&token)});self.db["bots"].as_array_mut().unwrap().push(bot);self.save()?;return Ok(json!({"token":token}));
   },
   "delete_bot"=>{self.db["bots"].as_array_mut().unwrap().retain(|b|!(b["id"]==v["id"]&&b["owner"]==uid));},
   "create_sticker"=>{
    let data=s(&v,"image");let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название стикера: 1–40 символов".into())}
    let (prefix,encoded)=data.split_once(',').ok_or("Нужен PNG или WebP")?;
    if !["data:image/png;base64","data:image/webp;base64"].contains(&prefix)||encoded.len()>350000{return Err("Стикер: PNG или WebP до 256 КБ".into())}
    let bytes=base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_|"Некорректное изображение")?;
    if !(bytes.starts_with(b"\x89PNG\r\n\x1a\n")||(bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"))){return Err("Некорректное изображение".into())}
    if arr(&self.db["stickers"]).iter().filter(|x|x["owner"]==uid).count()>=100{return Err("В наборе уже 100 стикеров".into())}
    let sticker=json!({"id":id(),"owner":uid,"name":name,"image":data});self.db["stickers"].as_array_mut().unwrap().push(sticker.clone());self.save()?;return Ok(sticker);
   },
   "reaction"=>{
    let message=arr(&self.db["messages"]).into_iter().find(|m|m["id"]==v["message"]).ok_or("Сообщение не найдено")?;
    if !self.allowed(uid,s(&message,"channel")){return Err("Нет доступа к чату".into())}
    let emoji=s(&v,"emoji");if !["👍","❤️","😂","🔥","🎉","👀"].contains(&emoji){return Err("Выберите реакцию".into())}
    let row=self.db["messages"].as_array_mut().unwrap().iter_mut().find(|m|m["id"]==v["message"]).unwrap();
    let mut reactions=arr(&row["reactions"]);if let Some(i)=reactions.iter().position(|r|r["user"]==uid&&r["emoji"]==emoji){reactions.remove(i);}else{reactions.push(json!({"user":uid,"emoji":emoji}));}row["reactions"]=json!(reactions);
   },
   "message"=>{let channel=s(&v,"channel");if !self.allowed(uid,channel){return Err("Нет доступа к чату".into())}let text=s(&v,"text").trim();let sticker=s(&v,"sticker");
    if !sticker.is_empty()&&!arr(&self.db["stickers"]).iter().any(|x|x["id"]==sticker&&(x["owner"]==uid||arr(&self.db["messages"]).iter().any(|m|m["sticker"]==sticker&&self.allowed(uid,s(m,"channel"))))){return Err("Стикер не найден".into())}
    if (text.is_empty()&&sticker.is_empty())||text.chars().count()>2000{return Err("Сообщение: 1–2000 символов".into())}self.db["messages"].as_array_mut().unwrap().push(json!({"id":id(),"channel":channel,"user":uid,"text":text,"sticker":sticker,"time":now()}));},
   _=>return Err("Неизвестная команда".into())
  }self.save()?;Ok(json!({"ok":true}))
 }
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn api(state:tauri::State<'_,Store>,request:Value)->Result<Value,String>{state.0.lock().map_err(|_|"База недоступна")?.request(request)}
#[cfg(test)]
mod tests{
 #[test]
 fn channel_edit_requires_owner_and_preserves_history(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let owner=b.db["users"][0].clone();let token=b.token(&owner,"test",false).unwrap();let g=b.db["groups"][0].clone();
  let guest=b.request(json!({"op":"register","name":"Guest","email":"edit@test.local","password":"strong-password"})).unwrap();
  b.request(json!({"op":"join_group","token":guest["token"],"invite":g["invite"]})).unwrap();
  for c in arr(&g["channels"]){
   b.request(json!({"op":"message","token":token,"channel":c["id"],"text":"Keep me"})).unwrap();
   assert!(b.request(json!({"op":"update_channel","token":guest["token"],"group":g["id"],"channel":c["id"],"name":"Forbidden"})).is_err());
   for name in [String::new()," ".into(),"a".repeat(41)]{assert!(b.request(json!({"op":"update_channel","token":token,"group":g["id"],"channel":c["id"],"name":name})).is_err());}
   let edited=b.request(json!({"op":"update_channel","token":token,"group":g["id"],"channel":c["id"],"name":" Updated "})).unwrap();
   assert_eq!(edited["id"],c["id"]);assert_eq!(edited["kind"],c["kind"]);assert_eq!(edited["name"],"Updated");
  }
  drop(b);let mut b=Backend::open(path).unwrap();let state=b.request(json!({"op":"state","token":token})).unwrap();
  assert!(arr(&state["groups"][0]["channels"]).iter().all(|c|c["name"]=="Updated"));assert_eq!(arr(&state["messages"]).len(),arr(&g["channels"]).len());
 }

 use super::*;

 #[test]
 fn group_email_invite_grants_persistent_text_and_voice_access(){
  let path=std::env::temp_dir().join(id()).join("db.json");
  let mut backend=Backend::open(path.clone()).unwrap();
  let owner=backend.db["users"][0].clone();
  let owner_token=backend.token(&owner,"test",false).unwrap();
  let guest=backend.request(json!({"op":"register","name":"Guest","email":"guest@example.test","password":"strong-password"})).unwrap();
  let guest_token=&guest["token"];
  let group=backend.request(json!({"op":"create_group","token":owner_token,"name":"Project"})).unwrap();
  let invite=json!({"op":"invite_group_member","token":owner_token,"group":group["id"],"email":" Guest@Example.Test "});
  let message=json!({"op":"message","token":guest_token,"channel":group["channels"][0]["id"],"text":"Hello"});
  let voice=json!({"op":"voice_join","token":guest_token,"room":group["channels"][1]["id"],"client":id()});
  let state=json!({"op":"state","token":guest_token});
  assert_eq!(backend.request(state.clone()).unwrap()["groups"],json!([]));
  assert!(backend.request(message.clone()).is_err());
  assert!(backend.request(voice.clone()).is_err());
  let mut unauthorized=invite.clone();
  unauthorized["token"]=guest_token.clone();
  assert_eq!(backend.request(unauthorized).unwrap_err(),"Участников приглашает владелец группы");
  let mut unknown=invite.clone();
  unknown["email"]=json!("unknown@example.test");
  assert_eq!(backend.request(unknown).unwrap_err(),"Аккаунт с этой почтой не найден");
  backend.request(invite.clone()).unwrap();
  backend.request(invite).unwrap();

  drop(backend);
  let mut backend=Backend::open(path).unwrap();
  let joined=&backend.request(state).unwrap()["groups"][0];
  assert_eq!(joined["id"],group["id"]);
  assert_eq!(joined["members"],json!([owner["id"],guest["user"]["id"]]));
  backend.request(message).unwrap();
  assert_eq!(backend.request(voice).unwrap()["peers"][0]["user"],guest["user"]["id"]);
 }

 #[test]
 fn created_rooms_return_persisted_identity(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let a=b.request(json!({"op":"register","name":"Alice","email":"rooms@test.local","password":"strong-password"})).unwrap();let t=&a["token"];
  let g=b.request(json!({"op":"create_group","token":t,"name":"Project"})).unwrap();
  assert!(g["id"].is_string(),"Creation must identify the saved group");
  let c=b.request(json!({"op":"create_channel","token":t,"group":g["id"],"name":"Planning","kind":"text"})).unwrap();
  assert!(c["id"].is_string());
  let other=b.request(json!({"op":"register","name":"Bob","email":"rooms-b@test.local","password":"strong-password"})).unwrap();let bt=&other["token"];
  assert!(b.request(json!({"op":"message","token":bt,"channel":c["id"],"text":"private"})).is_err());
  let joined=b.request(json!({"op":"join_group","token":bt,"invite":g["invite"]})).unwrap();assert_eq!(joined["id"],g["id"]);
  b.request(json!({"op":"join_group","token":bt,"invite":g["invite"]})).unwrap();
  b.request(json!({"op":"message","token":bt,"channel":c["id"],"text":"Saved message"})).unwrap();
  drop(b);let mut b=Backend::open(path).unwrap();let state=b.request(json!({"op":"state","token":t})).unwrap();
  assert_eq!(state["groups"][0]["id"],g["id"]);assert_eq!(arr(&state["groups"][0]["members"]).len(),2);
  assert!(arr(&state["groups"][0]["channels"]).contains(&c));assert_eq!(state["messages"][0]["text"],"Saved message");
 }


 #[test]
 fn account_avatar_and_email(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let a=b.request(json!({"op":"register","name":"Avatar","email":"avatar@test.local","password":"strong-password"})).unwrap();let t=&a["token"];
  let avatar="data:image/png;base64,iVBORw0KGgo=";
  b.request(json!({"op":"update_profile","token":t,"profile":{"name":"Avatar","bio":"","avatar":avatar}})).unwrap();
  assert_eq!(b.request(json!({"op":"me","token":t})).unwrap()["user"]["avatar"],avatar);
  assert!(b.request(json!({"op":"update_profile","token":t,"profile":{"name":"Avatar","bio":"","avatar":"https://invalid"}})).is_err());
  assert!(b.request(json!({"op":"change_email","token":t,"email":"new@test.local","current_password":"wrong"})).is_err());
  assert!(b.request(json!({"op":"change_email","token":t,"email":"broken@","current_password":"strong-password"})).is_err());
  b.request(json!({"op":"register","name":"Other","email":"taken@test.local","password":"strong-password"})).unwrap();
  assert!(b.request(json!({"op":"change_email","token":t,"email":"taken@test.local","current_password":"strong-password"})).is_err());
  b.request(json!({"op":"change_email","token":t,"email":" NEW@test.local ","current_password":"strong-password"})).unwrap();
  assert!(b.request(json!({"op":"login","email":"avatar@test.local","password":"strong-password"})).is_err());
  let mut b=Backend::open(path).unwrap();
  let login=b.request(json!({"op":"login","email":"new@test.local","password":"strong-password"})).unwrap();
  assert_eq!(login["user"]["avatar"],avatar);
 }
 #[test]
 fn sessions_profile_and_migration(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let credentials=json!({"op":"register","name":"Alice","email":"session@test.local","password":"strong-password","device":"Device A"});
  let a=b.request(credentials.clone()).unwrap();let mut login=credentials;login["op"]=json!("login");login["device"]=json!("Device B");let c=b.request(login.clone()).unwrap();
  let at=s(&a,"token");let ct=s(&c,"token");
  let sessions=b.request(json!({"op":"sessions","token":at})).unwrap();assert_eq!(arr(&sessions).len(),2);assert!(!sessions.to_string().contains("token_hash"));
  assert!(!std::fs::read_to_string(&path).unwrap().contains(at));
  b.request(json!({"op":"logout","token":at})).unwrap();assert!(b.authenticate(at).is_err());assert!(b.authenticate(ct).is_ok());
  b.request(json!({"op":"update_profile","token":ct,"profile":{"name":"New Alice","bio":"Hello"}})).unwrap();
  assert!(b.request(json!({"op":"update_profile","token":ct,"profile":{"name":"Alice","bio":"","email":"hijack@test"}})).is_err());
  drop(b);let mut b=Backend::open(path.clone()).unwrap();assert_eq!(b.request(json!({"op":"me","token":ct})).unwrap()["user"]["bio"],"Hello");
  let other=b.request(json!({"op":"register","name":"Other","email":"other@test.local","password":"strong-password"})).unwrap();
  assert!(b.request(json!({"op":"revoke_session","token":s(&other,"token"),"session_id":sessions[1]["id"]})).is_err());
  b.request(json!({"op":"revoke_session","token":ct,"session_id":sessions[1]["id"]})).unwrap();assert!(b.authenticate(ct).is_err());
  let c=b.request(login.clone()).unwrap();let ct=s(&c,"token");
  assert!(b.request(json!({"op":"change_password","token":ct,"current_password":"wrong","password":"changed-password"})).is_err());
  b.request(json!({"op":"change_password","token":ct,"current_password":"strong-password","password":"changed-password"})).unwrap();assert!(b.authenticate(ct).is_err());assert!(b.request(login.clone()).is_err());
  login["password"]=json!("changed-password");let c=b.request(login).unwrap();let ct=s(&c,"token");
  b.db["sessions"].as_array_mut().unwrap().iter_mut().find(|x|x["token_hash"]==token_hash(ct)).unwrap()["expires_at"]=json!(now()-1);assert!(b.authenticate(ct).is_err());
  b.db.as_object_mut().unwrap().remove("sessions");b.save().unwrap();drop(b);let b=Backend::open(path.clone()).unwrap();assert!(b.db["sessions"].is_array());assert!(b.authenticate(ct).is_err());
  std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
 }
 #[test]
 fn auth_privacy_persistence(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let a=b.request(json!({"op":"register","name":"Alice","email":"a@test.local","password":"a-strong-password"})).unwrap();
  let c=b.request(json!({"op":"register","name":"Carol","email":"c@test.local","password":"another-password"})).unwrap();let at=s(&a,"token");let ct=s(&c,"token");
  assert!(b.request(json!({"op":"state","token":format!("{at}x")})).is_err());
  assert!(b.request(json!({"op":"login","email":"a@test.local","password":"wrong-password"})).is_err());
  assert!(b.request(json!({"op":"register","name":"Duplicate","email":"A@test.local","password":"another-password"})).is_err());
  b.request(json!({"op":"create_group","token":at,"name":"Private"})).unwrap();let state=b.request(json!({"op":"state","token":at})).unwrap();let channel=&state["groups"][0]["channels"][0]["id"];
  assert!(b.request(json!({"op":"message","token":ct,"channel":channel,"text":"intrusion"})).is_err());
  assert!(b.request(json!({"op":"create_channel","token":ct,"group":state["groups"][0]["id"],"name":"intrusion"})).is_err());
  b.request(json!({"op":"message","token":at,"channel":channel,"text":"secret"})).unwrap();assert!(arr(&b.request(json!({"op":"state","token":ct})).unwrap()["messages"]).is_empty());
  let d=b.request(json!({"op":"create_dialog","token":at,"members":[c["user"]["id"]]})).unwrap();let d2=b.request(json!({"op":"create_dialog","token":ct,"members":[a["user"]["id"]]})).unwrap();assert_eq!(d["id"],d2["id"]);
  b.request(json!({"op":"message","token":ct,"channel":d["id"],"text":"hello"})).unwrap();drop(b);let mut b=Backend::open(path.clone()).unwrap();assert_eq!(arr(&b.request(json!({"op":"state","token":at})).unwrap()["messages"]).len(),2);
  b.request(json!({"op":"logout","token":at})).unwrap();assert!(b.request(json!({"op":"state","token":at})).is_err());
  assert!(b.authenticate("invalid").is_err());
  std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
 }
}

pub async fn serve(backend:Backend)->Result<(),Box<dyn std::error::Error>>{
 use axum::{extract::State,Json,routing::{post,get},Router,http::StatusCode};
 use std::sync::Arc;
 async fn request(State(store):State<Arc<Mutex<Backend>>>,headers:axum::http::HeaderMap,Json(mut v):Json<Value>)->axum::response::Response{
  use axum::response::IntoResponse;
  if headers.get("sec-fetch-site").and_then(|h|h.to_str().ok())==Some("cross-site"){return StatusCode::FORBIDDEN.into_response()}
  let cookie=headers.get("cookie").and_then(|h|h.to_str().ok()).unwrap_or("");
  v["token"]=json!(cookie.split(';').map(str::trim).find_map(|c|c.strip_prefix("mines_session=")).unwrap_or(""));
  let op=s(&v,"op").to_string();
  v["bot_token"]=json!(headers.get("authorization").and_then(|h|h.to_str().ok()).and_then(|h|h.strip_prefix("Bearer ")).unwrap_or(""));
  if op=="login"||op=="register"{v["device"]=json!(headers.get("user-agent").and_then(|h|h.to_str().ok()).unwrap_or("Browser"));}
  let max_age=session_lifetime(v["remember_me"].as_bool().unwrap_or(false));
  let result=tokio::task::spawn_blocking(move||store.lock().map_err(|_|"База недоступна".to_string())?.request(v)).await;
  let mut cookie=None;
  let (status,body)=match result{Ok(Ok(mut data))=>{if let Some(token)=data.get("token").and_then(Value::as_str).filter(|_|op=="login"||op=="register"){cookie=Some(format!("mines_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"));data.as_object_mut().unwrap().remove("token");}if ["logout","logout_all","change_password"].contains(&op.as_str()){cookie=Some("mines_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".into());}(StatusCode::OK,json!({"data":data}))},Ok(Err(error))=>(if error=="AUTH_REQUIRED"{StatusCode::UNAUTHORIZED}else{StatusCode::BAD_REQUEST},json!({"error":error})),Err(_)=>(StatusCode::INTERNAL_SERVER_ERROR,json!({"error":"Ошибка сервера"}))};
  let mut response=(status,Json(body)).into_response();
  response.headers_mut().insert("cache-control","no-store".parse().unwrap());
  if let Some(mut cookie)=cookie{if std::env::var("MINES_SECURE_COOKIE").as_deref()==Ok("1"){cookie.push_str("; Secure")}response.headers_mut().insert("set-cookie",cookie.parse().unwrap());}
  response
 }
 let app=Router::new().route("/api",post(request)).route("/health",get(||async{"Mines ready"})).with_state(Arc::new(Mutex::new(backend)));
 let bind=std::env::var("MINES_BIND").unwrap_or("127.0.0.1:3847".into());
 let listener=tokio::net::TcpListener::bind(&bind).await?;axum::serve(listener,app).await?;Ok(())
}

#[cfg(test)]
mod remember_tests {
 use super::*;
 #[test]
 fn remembered_session_survives_inactivity_until_year_boundary(){
  let path=std::env::temp_dir().join(format!("mines-remember-{}",id())).join("db.json");
  let mut b=Backend::open(path.clone()).unwrap();
  let a=b.request(json!({"op":"register","email":"remember@test.local","name":"Remember","password":"strong-password","remember_me":true})).unwrap();
  let t=s(&a,"token");let row=b.db["sessions"][0].clone();let start=row["created_at"].as_u64().unwrap();
  assert_eq!(row["expires_at"].as_u64().unwrap()-start,YEAR_SECONDS);
  assert!(session_active(&row,start+YEAR_SECONDS-1));assert!(!session_active(&row,start+YEAR_SECONDS));
  drop(b);let mut b=Backend::open(path.clone()).unwrap();assert!(b.authenticate(t).is_ok());
  let normal=b.request(json!({"op":"login","email":"remember@test.local","password":"strong-password"})).unwrap();
  let row=b.db["sessions"][1].clone();let start=row["created_at"].as_u64().unwrap();
  assert_eq!(row["expires_at"].as_u64().unwrap()-start,2592000);assert!(!session_active(&row,start+604800));
  assert!(b.authenticate(s(&normal,"token")).is_ok());assert_eq!(arr(&b.request(json!({"op":"sessions","token":t})).unwrap()).len(),2);
  b.request(json!({"op":"logout","token":t})).unwrap();assert!(b.authenticate(t).is_err());
  std::fs::remove_file(path).unwrap();
 }
}
#[cfg(test)]
mod voice_tests {
 use super::*;
 #[test]
 fn room_membership_signals_and_cleanup(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let owner=b.db["users"][0].clone();let token=b.token(&owner,"test",false).unwrap();let room=b.db["groups"][0]["channels"][4]["id"].clone();
  let outsider=b.request(json!({"op":"register","name":"Other","email":"voice@test.local","password":"strong-password"})).unwrap();
  let a=id();let c=id();
  assert!(b.request(json!({"op":"voice_join","token":outsider["token"],"room":room,"client":a})).is_err());
  b.request(json!({"op":"voice_join","token":token,"room":room,"client":a})).unwrap();
  b.request(json!({"op":"voice_join","token":token,"room":room,"client":c})).unwrap();
  b.request(json!({"op":"voice_signal","token":token,"room":room,"client":a,"target":c,"payload":{"description":{"type":"offer","sdp":"test"}}})).unwrap();
  let poll=b.request(json!({"op":"voice_poll","token":token,"room":room,"client":c})).unwrap();assert_eq!(arr(&poll["peers"]).len(),2);assert_eq!(arr(&poll["signals"]).len(),1);assert!(!poll["peers"].to_string().contains("session"));
  assert!(arr(&b.request(json!({"op":"voice_poll","token":token,"room":room,"client":c,"after":poll["cursor"]})).unwrap()["signals"]).is_empty());
  b.request(json!({"op":"voice_leave","token":token,"room":room,"client":a})).unwrap();assert!(b.request(json!({"op":"voice_signal","token":token,"room":room,"client":a,"target":c,"payload":{}})).is_err());
  b.voice[0]["seen"]=json!(now()-21);assert!(b.request(json!({"op":"voice_poll","token":token,"room":room,"client":c})).is_err());
  drop(b);std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
 }
}

#[cfg(test)]
mod social_tests {
 use super::*;
 #[test]
 fn reactions_stickers_friends_and_scoped_bots(){
  let path=std::env::temp_dir().join(id()).join("db.json");let mut b=Backend::open(path.clone()).unwrap();
  let owner=b.db["users"][0].clone();let token=b.token(&owner,"test",false).unwrap();let channel=b.db["groups"][0]["channels"][0]["id"].clone();let uid=owner["id"].clone();
  let guest=b.request(json!({"op":"register","name":"Guest","email":"social@test.local","password":"strong-password"})).unwrap();let gt=guest["token"].clone();let gid=guest["user"]["id"].clone();
  b.request(json!({"op":"message","token":token,"channel":channel,"text":"hello"})).unwrap();let mid=b.db["messages"][0]["id"].clone();
  assert!(b.request(json!({"op":"reaction","token":gt,"message":mid,"emoji":"👍"})).is_err());
  b.request(json!({"op":"reaction","token":token,"message":mid,"emoji":"👍"})).unwrap();assert_eq!(arr(&b.db["messages"][0]["reactions"]).len(),1);
  b.request(json!({"op":"reaction","token":token,"message":mid,"emoji":"👍"})).unwrap();assert!(arr(&b.db["messages"][0]["reactions"]).is_empty());
  let image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
  let st=b.request(json!({"op":"create_sticker","token":token,"name":"Test","image":image})).unwrap();
  assert!(b.request(json!({"op":"create_sticker","token":token,"name":"bad","image":"data:image/png;base64,aGVsbG8="})).is_err());
  assert!(b.request(json!({"op":"message","token":gt,"channel":channel,"sticker":st["id"]})).is_err());
  b.request(json!({"op":"message","token":token,"channel":channel,"sticker":st["id"]})).unwrap();
  b.request(json!({"op":"friend_request","token":token,"user":gid})).unwrap();let fid=b.db["friends"][0]["id"].clone();
  assert!(b.request(json!({"op":"friend_accept","token":token,"id":fid})).is_err());b.request(json!({"op":"friend_accept","token":gt,"id":fid})).unwrap();
  assert!(b.request(json!({"op":"create_bot","token":gt,"channel":channel,"name":"bad"})).is_err());
  let bot=b.request(json!({"op":"create_bot","token":token,"channel":channel,"name":"Helper"})).unwrap();let bt=bot["token"].clone();
  b.request(json!({"op":"bot_message","bot_token":bt,"channel":"ignored","text":"bot reply"})).unwrap();
  let poll=b.request(json!({"op":"bot_poll","bot_token":bt})).unwrap();assert_eq!(arr(&poll["messages"]).len(),3);assert_eq!(poll["messages"][2]["channel"],channel);
  assert!(b.request(json!({"op":"state","token":bt})).is_err());assert!(!b.state(&owner).to_string().contains("token_hash"));assert!(!std::fs::read_to_string(&path).unwrap().contains(bt.as_str().unwrap()));
  drop(b);let mut b=Backend::open(path.clone()).unwrap();assert_eq!(b.db["friends"][0]["accepted"],true);assert_eq!(b.db["stickers"][0]["id"],st["id"]);assert_eq!(b.db["friends"][0]["from"],uid);
  let bid=b.db["bots"][0]["id"].clone();b.request(json!({"op":"delete_bot","token":token,"id":bid})).unwrap();assert!(b.request(json!({"op":"bot_poll","bot_token":bt})).is_err());
  drop(b);std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
 }
}
