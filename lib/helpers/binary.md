## helpers for binary streams  
`import { binaryReader, binaryWriter } from 'f-streams-async'`  
----  
* `reader = binaryReader(reader, options)`  
  Wraps a raw Buffer reader and returns a reader with additional API to handle binary streams.  
  By default the reader is configured as big endian.  
  You can configure it as little endian by setting the `endian` option to `"little"`.  
* `buf = await reader.read(len)`  
  returns the `len` next bytes of the stream.  
  returns a buffer of length `len`, except at the end of the stream.  
  The last chunk of the stream may have less than `len` bytes and afterwards the call  
  returns `undefined`.  
  If the `len` parameter is omitted, the call returns the next available chunk of data.  
* `buf = await reader.peek(len)`  
  Same as `read` but does not advance the read pointer.  
  Another `read` would read the same data again.  
* `await reader.peekAll()`  
  Same as `readAll` but does not advance the read pointer.  
* `reader.unread(len)`  
  Unread the last `len` bytes read.  
  `len` cannot exceed the size of the last read.  
* `val = await reader.readInt8()`  
* `val = await reader.readUInt8()`  
* `val = await reader.readInt16()`  
* `val = await reader.readUInt16()`  
* `val = await reader.readInt32()`  
* `val = await reader.readUInt32()`  
* `val = await reader.readFloat()`  
* `val = await reader.readDouble()`  
  Specialized readers for numbers.  
* `val = await reader.peekInt8()`  
* `val = await reader.peekUInt8()`  
* `val = await reader.peekInt16()`  
* `val = await reader.peekUInt16()`  
* `val = await reader.peekInt32()`  
* `val = await reader.peekUInt32()`  
* `val = await reader.peekFloat()`  
* `val = await reader.peekDouble()`  
  Specialized peekers for numbers.  
* `val = await reader.unreadInt8()`  
* `val = await reader.unreadUInt8()`  
* `val = await reader.unreadInt16()`  
* `val = await reader.unreadUInt16()`  
* `val = await reader.unreadInt32()`  
* `val = await reader.unreadUInt32()`  
* `val = await reader.unreadFloat()`  
* `val = await reader.unreadDouble()`  
  Specialized unreaders for numbers.  
----  
* `writer = binaryWriter(writer, options)`  
  Wraps a raw buffer writer and returns a writer with additional API to handle binary streams.  
  By default the writer is configured as big endian.  
  You can configure it as little endian by setting the `endian` option to `"little"`.  
  The `bufSize` option controls the size of the intermediate buffer.  
* `await writer.flush()`  
  Flushes the buffer to the wrapped writer.  
* `await writer.write(buf)`  
  Writes `buf`.  
  Note: writes are buffered.  
  Use the `await flush()` call if you need to flush before the end of the stream.  
* `await writer.writeInt8(val)`  
* `await writer.writeUInt8(val)`  
* `await writer.writeInt16(val)`  
* `await writer.writeUInt16(val)`  
* `await writer.writeInt32(val)`  
* `await writer.writeUInt32(val)`  
* `await writer.writeFloat(val)`  
* `await writer.writeDouble(val)`  
  Specialized writers for numbers.  
