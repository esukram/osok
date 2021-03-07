import { listenAndServe, ServerRequest } from "https://deno.land/std@0.83.0/http/server.ts";
import { Status } from "https://deno.land/std@0.83.0/http/http_status.ts";
import Mutex from "https://deno.land/x/await_mutex@v1.0.1/mod.ts"

import startWorker from "./k8s.ts";

const env = Deno.env.toObject()
const PORT = Number(env.PORT) || 8000
const HOST = env.HOST || '127.0.0.1'
const HOSTNAME = env.HOSTNAME || 'localhost'
const options = { hostname: HOST, port: PORT };
const COOL_DOWN = Number(env.COOL_DOWN) || 15;

const HDR_TENANT = "X-Tenant-ID";
const HDR_X_FORWARED = "X-Forwarded-For";
const MAX_RETRY = 10;
const MAX_SCALE = env.MAX_SCALE || 0;

const mutex = new Mutex();

type Connection = {
    id: number,
    remote: string,
    tenantId: string,
    url: string
}

type Slot = {
    port: number,
    running: boolean,
    ctr?: string,
    timer?: number,
    connection?: Connection,
    tenantId?: string
}

// init available backend slots
const slots: Array<Slot> = [];
for (let i = 1; i <= MAX_SCALE; ++i) {
    slots.push({
        port: PORT + i,
        running: false
    });
}

function delay(ms: number): Promise<void> {
    return new Promise<void>( resolve => setTimeout(resolve, ms) );
}

const extractConnection = (req: ServerRequest): Connection => {
    const tenantId = req.headers.get(HDR_TENANT);
    // tenant id is mandatory
    if (!tenantId) {
        throw new Error("No tenant ID set");
    }

    const conn: Connection = {
        id: req.conn.rid,
        remote: req.headers.get(HDR_X_FORWARED) ||
            (req.conn.remoteAddr as Deno.NetAddr).hostname,
        tenantId: tenantId,
        url: req.url
    };
    console.log(`|> Request from ${conn.remote}(${conn.id}): ${req.url}`)

    return conn;
}

const shutdownWorker = async (slot: Slot) => {
    slot.running = false;
    console.log(`X> Shutdown backend for ${slot.port} (${slot.ctr})`);
    delete slot.ctr;
    try {
        const res = await fetch(`http://127.0.0.1:${slot.port}/shutdown`);
        console.log(`X- Shutdown: ${await res.text()}`)
    } catch (e) {}
}

const setTimerOnSlot = (slot: Slot) => {
    clearTimeout(slot.timer);
    slot.timer = setTimeout(async () => {
        shutdownWorker(slot);
    }, COOL_DOWN * 1000);
}

const issueNewWorker = async (port: number, retry: number = 0): Promise<string> => {
    let runnerName;
    try {
        runnerName = await startWorker(port) !;
    } catch (e) {
        console.log(`|- Unable to start worker: ${port} (retry-lvl: ${retry})`);
        console.log(e);
        if (++retry < MAX_RETRY) {
            await delay(Math.pow(retry, 2) * 100);
            runnerName = await issueNewWorker(port, retry)
        } else {
            throw new Error(`Unable to start worker: ${port}\n${e}`);
        }
    }

    return runnerName;
}

const findSlot = async (conn: Connection) => {
    let slot: Slot;
    let newWorker = false;

    const acquisitionId = await mutex.acquire();
    try {
        // filter free slots
        const freeSlots = slots.filter(slot => !slot.connection);
        if (!freeSlots.length) {
            throw new Error("No free slots available");
        }

        // filter running
        const freeRunning = freeSlots.filter(slot => slot.running === true && slot.ctr);
        if (freeRunning.length) {
            // try to reuse slots for same tenants
            slot = freeRunning.filter(slot => slot.tenantId === conn.tenantId)?.shift() ||
                freeRunning.shift() !; // the '!' at the ensures non-null assertion
            if (!slot) throw new Error("No free running slot available");
            console.log(`|- Reused slot ${slot.port} (${slot.ctr})`);
        } else {
            slot = freeSlots.filter(slot => !slot.running).shift() !;
            if (!slot) throw new Error("No slot for starting worker");
            slot.running = true;
            newWorker = true;
            console.log(`|- Need to start new worker for ${slot.port}`);
        }
    } finally {
        mutex.release(acquisitionId);
    }

    return { slot, newWorker};
}

const aquireSlot = async (conn: Connection): Promise<Slot> => {
    const { slot, newWorker } = await findSlot(conn);

    if (newWorker) {
        // call K8s API
        slot.ctr = await issueNewWorker(slot.port);
        slot.connection = conn;
        console.log(`|- Started new worker (${slot.port}): ${slot.ctr}`);

        // let container start up
        await delay(750);
    }

    console.log(`|- Aquired slot entry ${slot.port}: ${conn?.remote}${conn.url}`);
    console.log(`|- Tenant reuse: ${slot.tenantId} / ${conn?.tenantId}`);

    slot.tenantId = conn.tenantId;
    setTimerOnSlot(slot);

    return slot;
}

const releaseSlot = (slot: Slot): void => {
    delete slot.connection;

    console.log(`|= Released slot entry ${slot.port}/${slot.tenantId}`);
}

const upstreamHandler = async (slot: Slot, req: ServerRequest, retry: number = 0): Promise<void> => {
    const reqBody = await Deno.readAll(req.body);

    const upstreamHost = `http://127.0.0.1:${slot.port}`;
    const url = `${upstreamHost}${req.url}`;

    const upReq = new Request(url, {
        method: req.method,
        headers: {
            "Content-Type": req.headers.get("Content-Type") !,
            HDR_X_FORWARED: slot.connection?.remote !,
            HDR_TENANT: slot.connection?.tenantId !
        },
        body: reqBody
    });

    try {
        const response = await fetch(upReq);
        const resBody = await response.json();

        resBody.pod = HOSTNAME;
        resBody.backend = slot.port;
        resBody.container = slot.ctr;

        req.respond({
            body: JSON.stringify(resBody),
            status: response.status
        });
    } catch (e) {
        console.log(`|-! Unable to query upstream ${slot.port}(${slot.ctr}) | retry: ${retry}`);
        if (retry >= MAX_RETRY) {
            // kill unhealthy worker
            await shutdownWorker(slot);

            throw new Error("Upstream worker container unhealthy 503");
        }

        await delay(Math.pow(++retry, 2) * 150);
        return await upstreamHandler(slot, req, retry);
    }
};

console.log(`Listening on ${HOST}:${PORT}`);
await listenAndServe(options, async (req: ServerRequest) => {
    let slot: Slot | undefined;
    try {
        slot = await aquireSlot(extractConnection(req));
        await upstreamHandler(slot, req);
    } catch (e: any) {
        console.log(e);
        req.respond({
            status: Status.ServiceUnavailable,
            body: e.message
        });
    } finally {
        if (slot) releaseSlot(slot);
    }
});
