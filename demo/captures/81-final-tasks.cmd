kubectl --context h100 -n orka-system get task dynamo-pr-shepherd dynamo-pr-shepherd-demo -o custom-columns=NAME:.metadata.name,SCHEDULE:.spec.schedule,SUSPENDED:.spec.suspend,PHASE:.status.phase
