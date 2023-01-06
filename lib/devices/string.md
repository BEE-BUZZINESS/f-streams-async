## In-memory string streams  
`import { stringReader, stringWriter } from 'f-streams-async'`  
* `reader = stringReader(text, options)`  
  creates a reader that reads its chunks from `text`.  
  `await reader.read()` will return the chunks asynchronously by default.  
  You can force synchronous delivery by setting `options.sync` to `true`.  
  The default chunk size is 1024. You can override it by passing  
  a `chunkSize` option.  
* `writer = stringWriter(options)`  
  creates a writer that collects strings into a text buffer.  
  `await writer.write(data)` will write asynchronously by default.  
  You can force synchronous write by setting `options.sync` to `true`.  
  `await writer.toString()` returns the internal text buffer into which the  
  strings have been collected.  
* `reader = await factory.reader()`  
* `writer = await factory.writer()`  
