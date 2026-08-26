<?php
namespace  App\Service;
use App\Repository\UserRepository;
class   UserService implements \Countable {
const   DEFAULT_LIMIT=25;
private array $cache=[];
public function __construct(private readonly UserRepository $users, protected ?string $log=null){}
public function count():int{ return count($this->cache); }
public function find(int $id, array $with=[]): ?object { return $this->users->find($id,$with); }
}
