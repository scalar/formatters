package com.example
import java.util.concurrent.TimeUnit
class Client(private val baseUrl:String,private val timeout:Long=30){
  private val headers=mutableMapOf<String,String>()
  fun listUsers(page:Int=1,perPage:Int=25,filter:Map<String,String> = emptyMap()):List<String> =
    request("GET","/users",mapOf("page" to page.toString(),"per_page" to perPage.toString())+filter)
  private fun request(method:String,path:String,query:Map<String,String>):List<String> = emptyList()
}
