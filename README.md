# Requestors 
A collection of [curried-parseq](https://github.com/jlrwi/curried-parseq)-style requestor factories, requestors, and tools. 
 
## Applied requestor factories 
Each of these factories corresponds to a curried-parseq factory, except that instead of applying a single value to a list (or object) of requestors, each value in a list (or object) is applied to a single requestor. 
 
applied_fallback({ 
    time_limit 
})( 
    requestor 
) 
 
applied_parallel({ 
    time_limit, 
    time_option, 
    throttle 
})( 
    requestor 
) 
 
applied_race({ 
    time_limit, 
    throttle 
})( 
    requestor 
) 
 
applied_parallel_object({ 
    time_limit, 
    time_option, 
    throttle 
})( 
    requestor 
) 
 
## Repetitive requestor factories 
 
### Chained requestor 
Repetitively run a requestor, aggregating its return values with a unary aggregator function, as long as the aggregate value passes a unary continuation predicate function. 
 
chained_requestor({ 
    continuer, 
    aggregator 
})( 
    requestor 
) 
 
### Repeat requestor 
Repetitively run a requestor as long as the return value passes a unary predicate function. 
 
repeat_requestor( 
    predicate 
)( 
    requestor 
) 
 
## Other requestor factories 
 
### Constant requestor 
Make a requestor that always returns the same value. This can be useful for inserting a value into a sequence of requestors. 
 
constant_requestor( 
    return_value 
) 
 
### Promise requestor 
Convert a Javascript promise to a requestor 
 
promise_requestor( 
    promise 
) 
 
### Unary requestor 
Turn a non-blocking unary function into a requestor. 
 
unary_requestor( 
    function 
) 
 
### Wait requestor 
Poll a predicate function at a specified interval until it returns true. 
 
wait_requestor({ 
    predicate, 
    args, 
    interval, 
    timeout 
})( 
    value 
) 
 
Parameters: 
- predicate: a unary function 
- args: arguments to apply to predicate (optional) 
- interval: the interval at which to poll the predicate 
- timeout: elapsed time at which to stop polling and fail (optional) 
- value: the value to return or function to invoke when the predicate succeeds 
 
### Indexed requestor 
Send each requestor in an array of requestors the corresponding value from the same index in the input array, running all the requestors in parallel. 
 
indexed_requestor({ 
    time_limit, 
    time_option, 
    throttle 
})( 
    requestors_array 
) 
 
### Record requestor 
Send each requestor in an object of requestors the corresponding property value from the input object, running all the requestors in parallel. 
 
record_requestor({ 
    time_limit, 
    time_option, 
    throttle 
})( 
    requestors_object 
) 
 
## Tools 
 
### Functional callback 
Create a requestor callback from functions to be invoked in the failure or success cases. The fail case will be called with the failure reason, while the success case will be called with the returned value. 
 
functional_callback( 
    failure_function 
)( 
    success_function 
) 
 
