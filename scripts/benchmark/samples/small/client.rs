use std::collections::HashMap;
pub struct Client{base_url:String,timeout:u64,headers:HashMap<String,String>}
impl Client{
pub fn new(base_url:impl Into<String>,timeout:u64)->Self{Self{base_url:base_url.into(),timeout,headers:HashMap::new()}}
pub fn list_users(&self,page:u32,per_page:u32)->Result<Vec<String>,Box<dyn std::error::Error>>{
let path=format!("/users?page={}&per_page={}",page,per_page);self.request("GET",&path)}
fn request(&self,_method:&str,_path:&str)->Result<Vec<String>,Box<dyn std::error::Error>>{Ok(vec![])}
}
