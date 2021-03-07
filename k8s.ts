import Mutex from "https://deno.land/x/await_mutex@v1.0.1/mod.ts"

const env = Deno.env.toObject();
const NAMESPACE = env.NAMESPACE || '';
const POD_NAME = env.POD_NAME || 'localhost';
const K8S_ENDPOINT = env.K8S_ENDPOINT || `https://kubernetes.default.svc.cluster.local:443`;

const mutex = new Mutex();

const container = {
  "args": [
      "run",
      "--allow-env",
      "--allow-net",
      "/app/app.ts"
  ],
  "env": [
      {
          "name": "PORT",
          "value": ""
      },
      {
          "name": "DENO_DIR",
          "value": "/app-cache"
      }
  ],
  "image": "hayd/alpine-deno:1.6.2",
  "imagePullPolicy": "IfNotPresent",
  "terminationMessagePath": "/dev/termination-log",
  "terminationMessagePolicy": "File",
  "name": "app-X",
  "volumeMounts": [
      {
          "mountPath": "/app",
          "name": "app",
          "readOnly": true
      },
      {
        "mountPath": "/app-cache",
        "name": "app-cache"
    }
  ]
}

const alphanums:string = "bcdfghjklmnpqrstvwxz2456789"
const generateRand = (len: number): string => {
    if (len < 0) throw new Error("Negative number!");

    let rand = "";
    let ranNum = -1;
    for (let i = 0; i < len; ++i) {
        ranNum = (Math.random() * 100) % alphanums.length;
        rand = rand.concat(alphanums.substring(ranNum, ranNum + 1));
    }

    return rand;
}

const generateK8sRequest = async (method: string, body: any = undefined) => {
  const token = await Deno.readTextFile(`/var/run/secrets/kubernetes.io/serviceaccount/token`);

  const uri = `/api/v1/namespaces/${NAMESPACE}/pods/${POD_NAME}/ephemeralcontainers`;
  const endpoint = `${K8S_ENDPOINT}${uri}`;

  const request = new Request(endpoint, {
      method: method,
      headers: {
      'Accept': 'application/json, */*',
      'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body)
  });

  return request;
}

const getEcs = async (): Promise<any> => {
  const response = await fetch(await generateK8sRequest('GET'));
  if (200 !== response.status) {
      throw new Error(`${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

const startWorker = async (port: number): Promise<string> => {
  // create new container object with random name
  const runner = {
    ...container
  };

  const acquisitionId = await mutex.acquire();

  try {
    // load existing ECs
    const ecs = await getEcs();

    runner.name = `app-${generateRand(5)}`;
    runner.env[0].value = port.toString();
    ecs.ephemeralContainers.push(runner);

    // generate request with new worker and execute
    console.log(`|-- starting new worker: ${runner.name}`);

    const request = await generateK8sRequest('PUT', ecs);
    const response = await fetch(request);
    if (200 !== response.status) {
        throw new Error(`${response.status}: ${await response.text()}`);
    }
  } finally {
    mutex.release(acquisitionId);
  }

  return runner.name;
}

export default startWorker;
