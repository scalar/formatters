import Foundation
struct Client{
let baseURL:String
var timeout:TimeInterval=30
func listUsers(page:Int=1,perPage:Int=25,filter:[String:String]=[:])->[String]{
let query=["page":String(page),"per_page":String(perPage)].merging(filter){ a,_ in a }
return request(method:"GET",path:"/users",query:query)}
private func request(method:String,path:String,query:[String:String])->[String]{ return [] }
}
