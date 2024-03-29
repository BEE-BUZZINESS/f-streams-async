## EZ Streams core reader API  
`import * as f from 'f-streams-async'`  
* `count = await reader.each(fn)`  
  Similar to `forEach` on arrays.  
  The `fn` function is called as `fn(elt, i)`.  
  This call is asynchonous. It returns the number of entries processed when the end of stream is reached.  
* `reader = reader.map(fn)`  
  Similar to `map` on arrays.  
  The `fn` function is called as `fn(elt, i)`.  
  Returns another reader on which other operations may be chained.  
* `result = await reader.every(fn)`  
  Similar to `every` on arrays.  
  The `fn` function is called as `fn(elt)`.  
  Returns true at the end of stream if `fn` returned true on every entry.  
  Stops streaming and returns false as soon as `fn` returns false on an entry.  
* `element = await reader.find(fn)`  
  Similar to `find` on arrays.  
  The `fn` function is called as `fn(elt)`.  
  Returns undefined at the end of stream if `fn` returned false on every entry.  
  Otherwise returns the first element on which `fn` returns true.  
* `result = await reader.some(fn)`  
  Similar to `some` on arrays.  
  The `fn` function is called as `fn(elt)`.  
  Returns false at the end of stream if `fn` returned false on every entry.  
  Stops streaming and returns true as soon as `fn` returns true on an entry.  
* `result = await reader.reduce(fn, initial)`  
  Similar to `reduce` on arrays.  
  The `fn` function is called as `fn(current, elt)` where `current` is `initial` on the first entry and  
  the result of the previous `fn` call otherwise.  
  Returns the value returned by the last `fn` call.  
* `writer = await reader.pipe(writer)`  
  Pipes from `stream` to `writer`.  
  Returns the writer for chaining.  
* `reader = reader.tee(writer)`  
  Branches another writer on the chain`.  
  Returns another reader on which other operations may be chained.  
* `readers = reader.dup()`  
  Duplicates a reader and returns a pair of readers which can be read from independently.  
* `reader = reader.concat(reader1, reader2)`  
  Concatenates reader with one or more readers.  
  Works like array.concat: you can pass the readers as separate arguments, or pass an array of readers.  
* `result = await reader.toArray()`  
  Reads all entries and returns them to an array.  
  Note that this call is an anti-pattern for streaming but it may be useful when working with small streams.  
* `result = await reader.readAll()`  
  Reads all entries and returns them as a single string or buffer. Returns undefined if nothing has been read.  
  Note that this call is an anti-pattern for streaming but it may be useful when working with small streams.  
* `reader = reader.transform(fn)`  
  Inserts an asynchronous transformation into chain.  
  This API is more powerful than `map` because the transformation function can combine results, split them, etc.  
  The transformation function `fn` is called as `fn(reader, writer)`  
  where `reader` is the `stream` to which `transform` is applied,  
  and writer is a writer which is piped into the next element of the chain.  
  Returns another reader on which other operations may be chained.  
* `result = reader.filter(fn)`  
  Similar to `filter` on arrays.  
  The `fn` function is called as `fn(elt, i)`.  
  Returns another reader on which other operations may be chained.  
* `result = reader.until(fn, testVal, stopArg)`  
  Cuts the stream by when the `fn` condition becomes true.  
  The `fn` function is called as `fn(elt, i)`.  
  `stopArg` is an optional argument which is passed to `stop` when `fn` becomes true.  
  Returns another reader on which other operations may be chained.  
* `result = reader.while(fn, testVal, stopArg)`  
  Cuts the stream by when the `fn` condition becomes false.  
  This is different from `filter` in that the result streams _ends_ when the condition  
  becomes false, instead of just skipping the entries.  
  The `fn` function is called as `fn(elt, i)`.  
  `stopArg` is an optional argument which is passed to `stop` when `fn` becomes false.  
  Returns another reader on which other operations may be chained.  
* `result = reader.limit(count, stopArg)`  
  Limits the stream to produce `count` results.  
  `stopArg` is an optional argument which is passed to `stop` when the limit is reached.  
  Returns another reader on which other operations may be chained.  
* `result = reader.skip(count)`  
  Skips the first `count` entries of the reader.  
  Returns another reader on which other operations may be chained.  
* `group = reader.fork(consumers)`  
  Forks the steam and passes the values to a set of consumers, as if each consumer  
  had its own copy of the stream as input.  
  `consumers` is an array of functions with the following signature: `reader = consumer(source)`  
  Returns a `StreamGroup` on which other operations can be chained.  
* `group = reader.parallel(count, consumer)`  
  Parallelizes by distributing the values to a set of  `count` identical consumers.  
  `count` is the number of consumers that will be created.  
  `consumer` is a function with the following signature: `reader = consumer(source)`  
  Returns a `StreamGroup` on which other operations can be chained.  
  Note: transformed entries may be delivered out of order.  
* `reader = reader.peekable()`  
  Returns a stream which has been extended with two methods to support lookahead.  
  The lookahead methods are:  
  - `await reader.peek()`: same as `await read()` but does not consume the item.  
  - `reader.unread(val)`: pushes `val` back so that it will be returned by the next `await read()`  
* `reader = reader.buffer(max)`  
  Returns a stream which is identical to the original one but in which up to `max` entries may have been buffered.  
* `stream = reader.nodify()`  
  converts the reader into a native node Readable stream.  
* `reader = reader.nodeTransform(duplex)`  
  pipes the reader into a node duplex stream. Returns another reader.  
* `cmp = await reader1.compare(reader2)`  
  compares reader1 and reader2 return 0 if equal,  
* `await reader.stop(arg)`  
  Informs the source that the consumer(s) has(ve) stopped reading.  
  The source should override this method if it needs to free resources when the stream ends.  
  `arg` is an optional argument.  
  If `arg` is falsy and the reader has been forked (or teed) upstream, only this reader stops (silently).  
  If `arg` is true, readers that have been forked upstream are stopped silently (their `read` returns undefined).  
  Otherwise `arg` should be an error object which will be thrown when readers that have been forked upstream try to read.  
  The default `stop` function is a no-op.  
  Note: `stop` is only called if reading stops before reaching the end of the stream.  
  Sources should free their resources both on `stop` and on end-of-stream.  
## StreamGroup API  
* `reader = group.dequeue()`  
  Dequeues values in the order in which they are delivered by the readers.  
  Returns a stream on which other operations may be chained.  
* `reader = group.rr()`  
  Dequeues values in round robin fashion.  
  Returns a stream on which other operations may be chained.  
* `reader = group.join(fn)`  
  Combines the values read from the readers to produce a single value.  
  `fn` is called as `fn(values)` where `values` is the set of values produced by  
  all the readers that are still active.  
  `fn` returns the value which will be read from the joined stream. `fn` _must_ also reset to `undefined` the `values` entries  
  that it has consumed. The next `read()` on the joined stream will fetch these values.  
  Note that the length of the `values` array will decrease every time an input stream is exhausted.  
  Returns a stream on which other operations may be chained.  
