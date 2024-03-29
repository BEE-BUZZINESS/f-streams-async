## Array readers and writers  
`import { arrayReader, arrayWriter } from 'f-streams-async'`  
* `reader = arrayReader(array, options)`  
  creates a reader that reads its entries from `array`.  
  `await reader.read()` will return its entries asynchronously by default.  
  You can force synchronous delivery by setting `options.sync` to `true`.  
* `writer = arrayWriter(options)`  
  creates a writer that collects its entries into an array.  
  `await writer.write(value)` will write asynchronously by default.  
  You can force synchronous write by setting `options.sync` to `true`.  
  `await writer.toArray()` returns the internal array into which the  
  entries have been collected.  
