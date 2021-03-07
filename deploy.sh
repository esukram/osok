#!/usr/bin/env bash
set -eu

# number of app variants
VARIANT=${VARIANT:-1}

# build config map with current code
kubectl create --dry-run=client configmap app -n app-x \
    --from-file=router.ts=router.ts \
    --from-file=app.ts=app.ts \
    --from-file=fibonacci.ts=fibonacci.ts \
    --from-file=k8s.ts=k8s.ts \
    -o yaml > app-2-cf.yaml

# add labels to configmap
cat << EOF >> app-2-cf.yaml
  labels:
    app: app-x
EOF

for counter in $(seq 1 $VARIANT); do
  echo "Deploying app variant: $counter"
  for manifest in app-*.yaml ; do
    cat "${manifest}" | sed "s/app-x/app-${counter}/g" | kubectl apply -f -
  done
done

