# Easy Streams for node.js

f-streams-async is a simple but powerful streaming library for node.js.

This package has been forked from original [f-streams](https://github.com/Sage/f-streams) and adapted to be compliant with standard async/await instead of Fibers.

F-streams-async come in two flavors: _readers_ and _writers_. You pull data from _readers_ and you push data into _writers_.

The data that you push or pull may be anything: buffers and strings of course, but also simple values like numbers or Booleans, JavaScript objects, nulls, ...
There is only one value which has a special meaning: `undefined`. Reading `undefined` means that you have reached the end of a reader stream.
Writing `undefined` signals that you want to _end_ a writer stream.

F-streams-async use the [f-promise-async](https://github.com/s.berthier/f-promise-async) library.

## Installation

```sh
npm install f-streams-async
```

## Creating a stream

`f-streams-async` bundles streams for node APIs:

```typescript
import { consoleLog, stdInput, textFileReader, binaryFileWriter, stringReader } from 'f-streams-async';

const log = consoleLog; // console writer
const stdin = stdInput('utf8'); // stdin in text mode
const textRd = textFileReader(path); // text file reader
const binWr = binaryFileWriter(path); // binary file writer
const stringRd = stringReader(text); // in memory text reader
```

You can also wrap any node.js stream into an f-stream, with the `node` device. For example:

```typescript
import { nodeReader, nodeWriter } from 'f-streams-async';

const reader = nodeReader(fs.createReadStream(path)); // same as binaryFileReader
const writer = nodeWriter(fs.createWriteStream(path)); // same as binaryFileWriter
```

`f-streams-async` also provides wrappers for HTTP and socket clients and servers:

```typescript
import { httpClient, httpServer } from 'f-streams-async';
import { socketClient, socketServer } from 'f-streams-async';
```

Request and response objects for these clients and servers are readers and writers.

The `genericReader` and `genericWriter` functions lets you create your own f-streams-async. For example here is how you would implement a reader that returns numbers from 0 to n

```typescript
import { genericReader } from 'f-streams-async';

const numberReader = (n) => {
    let i = 0;
    return genericReader(async () => {
        if (i < n) return i++;
        else return undefined;
    });
};
```

To define your own reader you just need to pass an asynchronous `read() {...}` function to `genericReader`.

To define your own writer you just need to pass an asynchronous `write(val) {...}` function to `genericWriter`.

So, for example, here is how you can wrap mongodb APIs into f-streams-async:

```typescript
import { genericReader, genericWriter } from 'f-streams-async';

const reader = (cursor) => {
    return genericReader(async () => {
        const obj = await cursor.nextObject();
        return obj == null ? undefined : obj;
    });
};
const writer = (collection) => {
    let done;
    return genericWriter(async (val) => {
        if (val === undefined) done = true;
        if (!done) await collection.insert(val);
    });
};
```

But you don't have to do it. There are already f-streams-async _devices_ for many use cases.

## Basic read and write

You can read from a reader by calling its `read` method and you can write to a writer by calling its `write` method:

```typescript
var val = await reader.read();
await writer.write(val);
```

The `read` and `write` methods may be asynchronous.

`read` returns `undefined` at the end of a stream. Symmetrically, passing `undefined` to the `write` method of a writer ends the writer.

## Array-like API

You can treat an f-reader very much like a JavaScript array: you can filter it, map it, reduce it, etc. For example you can write:

```typescript
console.log(
    'pi~=' +
        4 *
            await numberReader(10000)
                .filter((n) => {
                    return n % 2; // keep only odd numbers
                })
                .map((n) => {
                    return n % 4 === 1 ? 1 / n : -1 / n;
                })
                .reduce((res, val) => {
                    return res + val;
                }, 0),
);
```

This will compute 4 \* (1 - 1/3 + 1/5 - 1/7 ...).

Every step of the chain, except the last one, returns a new reader.
The first reader produces all integers up to 9999.
The second one, which is returned by the `filter` call lets only the odd integers go through.
The third one, returned by the `map` call transforms the odd integers into alternating fractions.
The `reduce` step at the end combines the alternating fractions to produce the final result.

Rather academic here but in real life you often need to query databases or external services when filtering or mapping stream entries.
So this is very useful.

The Array-like API also includes `every`, `some` and `forEach`.
On the other hand it does not include `reduceRight` nor `sort`, as these functions are incompatible with streaming (they would need to buffer the entire stream).

The `forEach`, `every`, `find` and `some` functions are reducers and return when the stream has been completely processed, like `reduce` (see example further down),
 so they are asynchronous and need to be awaited.

Note: the `filter`, `every` and `some` methods can also be controlled by a mongodb filter condition rather than a function.
The following are equivalent:

```typescript
// filter expressed as a function
reader = numberReader(1000).filter((n) => {
    return n >= 10 && n < 20;
});

// mongo-style filter
reader = numberReader(1000).filter({
    $gte: 10,
    $lt: 20,
});
```

## Iterable interface

Readers implement the `Iterable` interface. You can iterate over a reader with a `for ... of ...` loop:

```typescript
for (const val of numberReader(1000)) {
    console.log(val);
}
```

## Pipe

Readers have a `pipe` method that lets you pipe them into a writer:

```typescript
await reader.pipe(writer);
```

For example we can output the odd numbers up to 100 to the console by piping the number reader to the console device:

```typescript
import { consoleLog } from 'f-streams-async';

await numberReader(100)
    .filter(n => {
        return n % 2; // keep only odd numbers
    })
    .pipe(consoleLog);
```

Note that `pipe` is also a reducer. So you can schedule operations which will be executed after the pipe has been fully processed.

A major difference with standard node streams is that `pipe` operations only appear once in a chain, at the end, instead of being inserted between processing steps.
The f-streams-async `pipe` does not return a reader.
Instead it returns its writer argument, so that you can chain other operations on the writer itself.
It is asynchronous and needs to be awaited.
Here is a typical use:

```typescript
import { stringWriter } from 'f-streams-async';

var result = (await numberReader(100)
    .map(function(n) {
        return n + ' ';
    })
    .pipe(stringWriter()))
    .toString();
```

In this example, the integers are mapped to strings which are written to an in-memory string writer. The string writer is returned by the `pipe` call and we obtain its contents by applying `toString()`.

## Infinite streams

You can easily create an infinite stream. For example, here is a reader stream that will return all numbers (\*) in sequence:

```typescript
import { genericReader } from 'f-streams-async';

const infiniteReader = () => {
    let i = 0;
    return genericReader(() => {
        return i++;
    });
};
```

(\*): not quite as `i++` will stop moving when `i` reaches 2\*\*53

F-streams-async have methods like `skip`, `limit`, `until` and `while` that let you control how many entries you will read, even if the stream is potentially infinite. Here are two examples:

```typescript
import { consoleLog } from 'f-streams-async';

// output 100 numbers after skipping the first 20
await infiniteReader()
    .skip(20)
    .limit(100)
    .pipe(consoleLog);

// output numbers until their square exceeds 1000
await infiniteReader()
    .until((n) => {
        return n * n > 1000;
    })
    .pipe(consoleLog);
```

Note: `while` and `until` conditions can also be expressed as mongodb conditions.

## Transformations

The array functions are nice but they have limited power.
They work well to process stream entries independently from each other but they don't allow us to do more complex operation like combining several entries into a bigger one, or splitting one entry into several smaller ones, or a mix of both.
This is something we typically do when we parse text streams: we receive chunks of texts; we look for special boundaries and we emit the items that we have isolated between boundaries.
Usually, there is not a one to one correspondance between the chunks that we receive and the items that we emit.

The `transform` function is designed to handle these more complex operations.
Typical code looks like:

```typescript
await stream.transform(async (reader, writer) => {
	// read items with `await reader.read()`
	// transform them (combine them, split them)
	// write transformation results with `await writer.write(result)`
	// repeat until the end of reader
}).filter(...).map(...).reduce(...);
```

You have complete freedom to organize your read and write calls: you can read several items, combine them and write only one result, you can read one item, split it and write several results, you can drop data that you don't want to transfer, or inject additional data with extra writes, etc.

Also, you are not limited to reading with the `read()` call, you can use any API available on a reader, even another transform. For example, here is how you can implement a simple CSV parser:

```typescript
const csvParser = (reader, writer) => {
    // get a lines parser from our transforms library
    const linesParser = fst.transforms.lines.parser();
    // transform the raw text reader into a lines reader
    reader = reader.transform(linesParser);
    // read the first line and split it to get the keys
    var keys = reader.read().split(',');
    // read the other lines
    reader.forEach(function(line) {
        // ignore empty line (we get one at the end if file is terminated by newline)
        if (line.length === 0) return;
        // split the line to get the values
        var values = line.split(',');
        // convert it to an object with the keys that we got before
        var obj = {};
        keys.forEach(function(key, i) {
            obj[key] = values[i];
        });
        // send the object downwards.
        writer.write(obj);
    });
};
```

You can then use this transform as:

```typescript
import { consoleLog, textFileReader } from 'f-streams-async';

textFileReader('mydata.csv')
    .transform(csvParser)
    .pipe(consoleLog);
```

Note that the transform is written with a `forEach` call which loops through all the items read from the input chain. This may seem incompatible with streaming but it is not.
This loop advances by executing asynchronous `reader.read()` and `writer.write(obj)` calls.
So it yields to the event loop and gives it chance to wake up other pending calls at other steps of the chain.
So, even though the code may look like a tight loop, it is not.
It gets processed one piece at a time, interleaved with other steps in the chain.

## Transforms library

The `lib/transforms` directory contains standard transforms:

-   [`linesParser`, `linesFormatter`](lib/transforms/lines.md): simple lines parser and formatter.
-   [`csvParser`, `csvFormatter`](lib/transforms/csv.md): CSV parser and formatter.
-   [`jsonParser`, `jsonFormatter`](lib/transforms/json.md): JSON parser and formatter.
-   [`xmlParser`, `xmlFormatter`](lib/transforms/xml.md): XML parser and formatter.
-   [`multipartParser`, `multipartFormatter`](lib/transforms/multipart.md): MIME multipart parser and formatter.

For example, you can read from a CSV file, filter its entries and write the output to a JSON file with:

```typescript
import { csvParser, jsonFormatter, textFileReader, textFileWriter }

textFileReader('users.csv').transform(csvParser())
	.filter(item => item.gender === 'F')
	.transform(jsonFormatter({ space: '\t' }))
	.pipe(textFileWriter('women.json'));
```

The transforms library is rather embryonic at this stage but you can expect it to grow.

## Interoperability with native node.js streams

`f-streams-async` are fully interoperable with native node.js streams.

You can convert a node.js stream to an _f_ stream:

```typescript
import { nodeReader, nodeWriter } from 'f-streams-async';

// converting a node.js readable stream to an f reader
const reader = nodeReader(stream);
// converting a node.js writable stream to an f writer
const writer = nodeWriter(stream);
```

You can also convert in the reverse direction, from an _f_ stream to a node.js stream:

```typescript
// converting an f reader to a node readable stream
const stream = reader.nodify();
// converting an f writer to a node writable stream
const stream = writer.nodify();
```

And you can transform an _f_ stream with a node duplex stream:

```typescript
// transforms an f reader into another f reader
reader = reader.nodeTransform(duplexStream);
```

## Lookahead

It is often handy to be able to look ahead in a stream when implementing parsers.
The reader API does not directly support lookahead but it includes a `peekable()` method which extends the stream with `peek` and `unread` methods:

```typescript
// reader does not support lookahead methods but peekableReader will.
const peekableReader = reader.peekable();
val = await peekableReader.peek(); // reads a value without consuming it.
val = await peekableReader.read(); // normal read
peekableReader.unread(val); // pushes back val so that it can be read again.
```

## Parallelizing

You can parallelize operations on a stream with the `parallel` call:

```typescript
await reader
    .parallel(4, function(source) {
        return source.map(fn1).transform(trans1);
    })
    .map(fn2)
    .pipe(writer);
```

In this example the `parallel` call will dispatch the items to 4 identical chains that apply the `fn1` mapping and the `trans1` transform.
The output of these chains will be merged, passed through the `fn2` mapping and finally piped to `writer`.

You can control the `parallel` call by passing an options object instead of an integer as first parameter.
The `shuffle` option lets you control if the order of entries is preserved or not.
By default it is false and the order is preserved but you can get better thoughput by setting `shuffle` to true if order does not matter.

## Fork and join

You can also fork a reader into a set of identical readers that you pass through different chains:

```typescript
const readers = reader.fork([
    (source) => {
        return source.map(fn1).transform(trans1);
    },
    (source) => {
        return source.map(fn2);
    },
    (source) => {
        return source.transform(trans3);
    },
]).readers;
```

This returns 3 streams which operate on the same input but perform different chains of operations.
You can then pipe these 3 streams to different outputs.

Note that you have to use futures (or callbacks) when piping these streams so that they are piped in parallel.
See the examples in the [`api-test.ts`](./test/server/api-test.ts) test file for some examples.

You can also `join` the group of streams created by a fork, with a joiner function that defines how entries are dequeued from the group.

```typescript
const streams = await reader
    .fork([
        (source) => {
            return source.map(fn1).transform(trans1);
        },
        (source) => {
            return source.map(fn2);
        },
        (source) => {
            return source.transform(trans3);
        },
    ])
    .join(joinerFn)
    .map(fn4)
    .pipe(writer);
```

This part of the API is still fairly experimental and may change a bit.

## Exception handling

Exceptions are propagated through the chains and you can trap them in the reducer which pulls the items from the chain.
You can naturally use try/catch:

```typescript
try {
    await textFileReader('users.csv')
        .transform(csvParser())
        .filter(item => item.gender === 'F')
        .transform(jsonFormatter({ space: '\t' }))
        .pipe(textFileWriter('women.json'));
} catch (ex) {
    logger.write(ex);
}
```

## Stopping a stream

Streams are not always consumed in full.
If a consumer stops reading before it has reached the end of a stream, it must inform the stream that it won't read any further so that the stream can release its resources.
This is achieved by propagating a `stop` notification upwards, to the source of the stream.
Streams that wrap node stream will release their event listeners when they receive this notification.

The stop API is a simple `stop` method on readers:

```typescript
await reader.stop(arg); // arg is optional - see below
```

Stopping becomes a bit tricky when a stream has been forked or teed.
The stop API provides 3 options to stop a branch:

-   Stopping only the current branch: the notification will be propagated to the fork but not further upwards, unless the other branches have also been stopped.
    This is the default when `arg` is falsy or omitted.
-   Stopping the current branch and closing the other branches silently.
    This is achieved by passing `true` as `arg`.
    The consumers of the other branches will receive the `undefined` end-of-stream marker when reading further.
-   Stopping the current branch and closing the other branches with an error.
    This is achieved by passing an error object as `arg`.
    The consumers of the other branches will get this error when reading further.

Note: In the second and third case values which had been buffered in the other branches before the stop call will still be delivered, before the end-of-stream marker or the error.
So they may not stop _immediately_.

Operations like `limit`, `while` or `until` send a `stop` notification upwards.

A writer may also decide to stop its stream processing chain.
If its `write` method throws an exception the current branch will be stopped and the exception will be propagated to other branches.
A writer may also stop the chain silently by throwing a `new StopException(arg)` where `arg` is the falsy or `true` value which will be propagated towards the source of the chain.

Note: writers also have a `stop` method but this method is only used internally to propagate exceptions in a `tee` or `fork`.

## Writer chaining

You can also chain operations on writers via a special `pre` property.
For example:

```typescript
// create a binary file writer
const rawWriter = binaryFileWriter('data.gzip');
// create another writer that applies a gzip transform before the file writer
const zipWriter = rawWriter.pre.nodeTransform(zlib.createGzip());
```

All the chainable operations available on readers (`map`, `filter`, `transform`, `nodeTransform`, ...)
can also be applied to writers through this `pre` property.

Note: the `pre` property was introduced to stress the fact that the operation is applied _before_
writing to the original writer, even though it appears _after_ in the chain.

## Backpressure

Backpressure is a non-issue. The f-streams-async plumbing takes care of the low level pause/resume dance on the reader side, and of the write/drain dance on the write side.
The event loop takes care of the rest.
So you don't have to worry about backpressure when writing f-streams-async code.

Instead of worrying about backpressure, you should worry about buffering.
You can control buffering on the source side by passing special options to `nodeReader(nodeStream, options)`.
See the [`node-wrappers`](./lib/node-wrappers.md) documentation (`ReadableStream`) for details.
You can also control buffering by injecting `buffer(max)` calls into your chains.
The typical pattern is:

```typescript
await reader
    .transform(T1)
    .buffer(N)
    .transform(T2)
    .pipe(writer);
```

## API

See the [API reference](API.md).

## More information

The following blog article gives background information on this API design:

-   [Easy node.js streams](http://bjouhier.wordpress.com/2013/12/17)

# License

This work is licensed under the terms of the [MIT license](http://en.wikipedia.org/wiki/MIT_License).
