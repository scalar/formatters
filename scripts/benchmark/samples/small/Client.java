package com.example;
import java.util.*;
class Client {
  private final Map<String,String> headers=new HashMap<>();
  Client(String baseUrl,int timeout){ this.baseUrl=baseUrl; this.timeout=timeout; }
  List<String> listUsers(int page,int perPage,String filter){
    return request("GET","/users?page="+page+"&per_page="+perPage+"&filter="+filter,null,Collections.emptyMap());
  }
}
