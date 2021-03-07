
type indexedArray = {
  [key: string]: string
}
type VolumeMount = {
  mountPath: string,
  name: string,
  readOnly?: boolean
}

type Metadata = {
  annotations?: { [key: string]: string; },
  creationTimestamp?: string,
  labels?: { [key: string]: string; },
  name: string,
  namespace?: string,
  resourceVersion?: string,
  uid?: string
}

type EphemeralContainer = {
  name: string,
  image: string,
  imagePullPolicy?: string,
  args: Array<string>,
  env: Array<indexedArray>,
  volumeMounts: [ [Object], [Object] ],
  terminationMessagePath?: string,
  terminationMessagePolicy?: "File"
}

/*
type EphemeralContainers = {
  kind: string,
  apiVersion: string,
  metadata: Metadata,
  ephemeralContainers: Array<EphemeralContainer>
}
*/

const container =            {
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
      }
  ],
  "image": "hayd/alpine-deno:1.6.2",
  "imagePullPolicy": "IfNotPresent",
  "name": "app-3",
  "resources": {},
  "terminationMessagePath": "/dev/termination-log",
  "terminationMessagePolicy": "File",
  "volumeMounts": [
      {
          "mountPath": "/app",
          "name": "app"
      },
      {
          "mountPath": "/var/run/secrets/kubernetes.io/serviceaccount",
          "name": "default-token-k6lsj",
          "readOnly": true
      }
  ]
}

const get_endpoint = async (method: string, body: any = undefined) => {
  const token = await Deno.readTextFile("/tmp/foo.token");

  const host = `https://localhost:49153`
  const uri = `/api/v1/namespaces/default/pods/app1/ephemeralcontainers`;

  const request = new Request(`${host}${uri}`, {
    method: method,
    headers: {
      'Accept': 'application/json, */*',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body)
  });
  
  return request;
}

const put_k8s = async () => {
  const ec = await get_k8s();

  const runner = {
    ...container
  };
  runner.name = 'app-1';
  runner.env[0].value = '8001';

  ec.ephemeralContainers.push(runner);
  //ec.ephemeralContainers[3].env[0].value = '8005';
  console.log(ec);

  const request = await get_endpoint('PUT', ec);
  const response = await fetch(request);
  console.log(`${response.status}: ${await response.text()}`);
}

const get_k8s = async (): Promise<any> => {
  const response = await fetch(await get_endpoint('GET'));
  const ec = await response.json();

  return ec;
}

put_k8s();

export default put_k8s;