# OSOK
**O**pinionated **S**erverless **o**n **K**ubernetes - but `OSOK` also could mean _[One Shot, One Kill](https://www.urbandictionary.com/define.php?term=One%20shot%20one%20kill)_.

## Architecure
What are the major architectural ideas for this naïve serverless framework?

###  Motivation
Usually serverless frameworks, which are based on Kubernetes, usually are using `Pods` as the smallest entity, like knative.

However, scheduling of a `Pod` is very expensive:
* Scheduler needs to find a node
* Init-container can delay start times
* IP address assignments/limitation (think AWS) as each `Pod` needs to have a dedicated one

### Solution
Reusing an existing, already scheduled `Pod` as long as possible (scale to zero use-case) by utilizing emphemeral container feature in Kubernetes. See [KEP 277](https://github.com/kubernetes/enhancements/tree/master/keps/sig-node/277-ephemeral-containers) for design and implementatio details.
