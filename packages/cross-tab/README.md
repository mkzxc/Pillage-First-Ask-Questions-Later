# @pillage-first/cross-tab

This package is based on [arnold-graf's cross-tab-worker](https://github.com/arnold-graf/cross-tab-worker).
Its purpose is to allow users to play with multiple tabs open.

## Relevant information

- An init method has been added to mantain _WORKER_INIT_ related behavior
- destroy has been renamed to terminate to make less changes to the repo
- fetcher function with related _Lock_ has been implemented to prevent corruptions
- TabPropagatedMessage has been added so that all Tabs can replicate an unique "action"
- small modifications have been done in cross-tab-worker and port-broker.worker.ts to adapt to linter
