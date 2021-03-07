import { listenAndServe, ServerRequest } from "https://deno.land/std@0.83.0/http/server.ts";
import { Status } from "https://deno.land/std@0.83.0/http/http_status.ts";
import { format } from "https://deno.land/std@0.74.0/datetime/mod.ts";

import Fibonacci from "./fibonacci.ts";

const env = Deno.env.toObject()
const PORT: number = Number(env.PORT) || 8000
const HOST = env.HOST || '127.0.0.1'

console.log(`Listening on ${HOST}:${PORT}`);
const options = { hostname: HOST, port: PORT };

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

// ✔

listenAndServe(options, async (req: ServerRequest) => {
    // TODO: needs to be own port - obviously ;)
    if (req.url === '/shutdown') {
        req.respond({ status: Status.NoContent});
        await delay(100);

        Deno.exit();
    }

    for (const header of req.headers.entries()) {
        console.log(header);
    }

    console.log(`Request from: ${req.headers.keys}`)
    if (req.method !== 'GET') {
        return req.respond({ status: Status.NotFound, body: "'Not Found\n" });
    }

    const urlPattern = req.url.match(/^\/fib\/([0-9]+)$/);
    if (! urlPattern ) {
        return req.respond({ status: Status.BadRequest, body: "Bad Request\n" });
    }

    const num = Fibonacci(Number(urlPattern[1]));

    const now = format(new Date(), "yyyy-MM-dd HH:mm:ss.SSS");
    console.log(`[${now}] ${PORT} => ${num}`);
    return req.respond({ body: `{ "result": ${num} }\n` });
});
