using System.Collections.Generic;using System;
class Client{
readonly string _baseUrl;int _timeout=30;
public Client(string baseUrl,int timeout){_baseUrl=baseUrl;_timeout=timeout;}
public IEnumerable<string> ListUsers(int page=1,int perPage=25,Dictionary<string,string> filter=null){
return Request("GET","/users",new Dictionary<string,string>{{"page",page.ToString()},{"per_page",perPage.ToString()}});}
IEnumerable<string> Request(string method,string path,Dictionary<string,string> query)=>new List<string>();
}
