## helpers for multiplex readers  
`import { multiplexReader } from 'f-streams-async'`  
----  
* `reader = multiplexReader(reader)`  
  Wraps raw Buffer readers and returns a reader of these multiple readers.  
