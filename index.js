/*jslint
    fudge, node
*/

import {
    pipe,
    identity,
    pipeN
} from "@jlrwi/combinators";
import {
    is_object,
    array_map,
    object_map,
    prop,
    type_check,
    minimal_object,
    functional_if,
    equals
} from "@jlrwi/esfunctions";
import parseq from "@jlrwi/parseq";
import requestor_type from "@jlrwi/requestor_type";

const req_type = requestor_type();

// Turn a non-blocking unary function into a requestor
const unary_requestor = function (unary_fx) {
    return function unary_requestor(callback) {
        return function (value) {
            try {
                callback(unary_fx(value));
            } catch (exception) {
                callback(undefined, exception.message);
            }
        };
    };
};

// Can be used to insert a value into a sequence of requestors
const constant_requestor = function (constant_value) {
    return function constant_requestor(callback) {
        return function (ignore) {
            callback(constant_value);
        };
    };
};

// Convert a promise to a requestor
const promise_requestor = function (promise_object) {
    return function promise_requestor(callback) {
        const on_err = function (err) {
            return callback(undefined, err.message);
        };

        return function (ignore) {
            promise_object.then(callback).catch(on_err);
        };
    };
};

// Return a generic callback function using on_success and on_fail functions
// Reversed parameter order in 2.0.0
const functional_callback = function (on_fail) {
    return function (on_success) {
        return function callback(value, reason) {
            if (value === undefined) {
                on_fail(reason);
            } else {
                on_success(value);
            }
        };
    };
};

// Requestor to wait for a predicate function to return true
const wait_requestor = function (callback) {
    return function ({predicate, args, interval, timeout, value}) {
        let timer;
        let limit;

// Can't return an undefined value from a requestor - use a timestamp
        if (value === undefined) {
            value = Date.now;
        }

// Check the predicate
        const tester = function () {
            const result = (
                (Array.isArray(args))
                ? predicate(...args)
                : predicate(args)
            );

            if (result === true) {

// Shut down any timeout timer
                if (limit !== undefined) {
                    clearTimeout(limit);
                    limit = undefined;
                }

// Shut down the interval timer
                clearInterval(timer);
                timer = undefined;

// Return the value to the callback
                callback(
                    (type_check("function")(value))
                    ? value()
                    : value
                );
            }
        };

// Shutdown the requestor if timed out
        const timeout_callback = function () {

            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }

            timeout = undefined;
            limit = undefined;
            callback(undefined, "Timeout exceeded");
        };

// Start the timer(s)
        try {
            timer = setInterval(tester, interval);
            if (type_check("number")(timeout)) {
                limit = setTimeout(timeout_callback, timeout);
            }
        } catch (exception) {
            callback(undefined, exception.message);
            return;
        }

// If user cancels, clear the timeout and interval timers
        return function cancel() {
            if (limit !== undefined) {
                clearTimeout(limit);
            }

            if (timeout !== undefined) {
                clearInterval(timer);
            }
        };
    };
};

// Take an object of requestors and send them the matching properties from the
// input object
const record_requestor = function (options = {}) {
    return function (requestors) {

        if (!is_object(requestors)) {
            throw "Invalid requestors object.";
        }

// Turn each key/requestor in the object of requestors into [key, requestor]
// With the corresponding val from input piped into each requestor
        const requestor_list = Object.keys(requestors).map(
            function (key) {
                return [
                    key,
                    function requestor(callback) {
                        return pipe(
                            prop(key)
                        )(
                            functional_if(
                                equals(undefined)
                            )(
// When the input is missing a key, return {}
                                constant_requestor(minimal_object())(callback),
// Otherwise call the requestor
                                requestors[key](callback)
                            )
                        );
                    }
                ];
            }
        );

        return parseq.parallel_object(
            options
        )(
            Object.fromEntries(requestor_list)
        );
    };
};

// Process of sequence of Kleisli-type requestors in the form
//      <a -> {fst: log, snd: b}>
// Compatible with Kleisli_Type in StaticTypesBasic
const kleisli_sequence_requestor = function (log_type) {
    return function (options) {

// Reformat initial input to be a pair
        const map_initial_value_to_pair = function (initial_value) {
            return {
                fst: log_type.empty(),
                snd: initial_value
            };
        };

// Take result in form {fst, {fst, snd}} and concat fst's to return {fst, snd}
        const map_result_to_pair = function ({fst, snd}) {
            return {
                fst: log_type.concat(fst)(snd.fst),
                snd: snd.snd
            };
        };

// Take each Klesli requestor and put in a pair with log passthrough
        const map_to_record = function (requestor) {
            return req_type.map(
                map_result_to_pair
            )(
                record_requestor()({
                    fst: unary_requestor(identity),
                    snd: requestor
                })
            );
        };

        return pipeN(
            array_map(map_to_record),
            parseq.sequence(options),
            req_type.contramap(map_initial_value_to_pair)
        );
    };
};

// Take a requestor and input value, and return a requestor that takes a
// callback but ignores the normal initial_value parameter
const preloaded_requestor = function (requestor) {
    return function (input) {
        return function preload_requestor(callback) {
            return function (ignore) {
                return requestor(callback)(input);
            };
        };
    };
};

// Take one of the original (curried) factories and return the applied version
// Produces: <a -> b> -> [a] -> [<a -> b>] -> [b]
const applied_requestor = function (processor) {
    return function (options = {}) {
        return function (requestor) {
            return function applied_requestor(final_callback) {
                return function (input_list) {

                    if (!Array.isArray(input_list)) {
                        final_callback(undefined, "Input is not an array");
                    }

                    return processor(
                        options
                    )(
                        array_map(preloaded_requestor(requestor))(input_list)
                    )(
                        final_callback
                    )(
                        0
                    );
                };
            };
        };
    };
};

const applied_race_requestor = applied_requestor(parseq.race);
const applied_parallel_requestor = applied_requestor(parseq.parallel);
const applied_fallback_requestor = applied_requestor(parseq.fallback);

// Produce the applied parallel object factory
// Result: <a -> b> -> {a} -> {<a -> b>} -> {b}
const applied_parallel_object_requestor = function (options = {}) {
    return function (requestor) {
        return function applied_requestor(final_callback) {
            return function (input_object) {

                if (!is_object(input_object)) {
                    final_callback(undefined, "Invalid input object");
                }

                const requestor_obj = object_map(
                    preloaded_requestor(requestor)
                )(
                    input_object
                );

                return parseq.parallel_object(
                    options
                )(
                    requestor_obj
                )(
                    final_callback
                )(
                    0
                );
            };
        };
    };
};

// Continue running a requestor as long as it passes a predicate function
const repeat_requestor = function (repeat_predicate) {
    return function (requestor) {
        return function repeater_requestor(callback) {
            return function (initial_value) {

                const repeater_callback = function (value, reason) {
                    if (value === undefined) {
                        callback(undefined, reason);
                        return;
                    }

// If the returned value passes the predicate function, re-run the requestor
                    if (repeat_predicate(value) === true) {
                        requestor(repeater_callback)(value);

// The returned value failed the predicate - no more repeats, return the value
                    } else {
                        callback(value);
                    }
                };

// Must pass the repeater test initially
                if (repeat_predicate(initial_value) === true) {
                    requestor(repeater_callback)(initial_value);
                } else {
                    callback(initial_value);
                }
            };
        };
    };
};

// Produce a requestor that repeats a requestor, aggregating return values,
// as long as the aggregate value passes a continuer function
const chained_requestor = function ({continuer, aggregator}) {

    if (continuer === undefined) {
        throw "Continuer function missing";
    }

    if (aggregator === undefined) {
        throw "Aggregator function missing";
    }

    return function (requestor) {
        return function chained_requestor(callback) {
            return function (initial_value) {
                const chained_callback = function (value, reason) {
                    if (value === undefined) {
                        callback(value, reason);
                        return;
                    }

// Aggregate the values
                    const result = aggregator(initial_value)(value);

// If result passes continuer, spawn another chained_requestor, otherwise return
                    const f = (
                        (continuer(result))
                        ? chained_requestor(
                            {continuer, aggregator}
                        )(
                            requestor
                        )(
                            callback
                        )
                        : callback
                    );

                    f(result);
                };

                return requestor(chained_callback)(initial_value);
            };
        };
    };
};

export {
    applied_race_requestor,
    applied_parallel_requestor,
    applied_fallback_requestor,
    applied_parallel_object_requestor,
    chained_requestor,
    unary_requestor,
    constant_requestor,
    promise_requestor,
    functional_callback,
    kleisli_sequence_requestor,
    repeat_requestor,
    record_requestor,
    wait_requestor
};