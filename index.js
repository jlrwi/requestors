/*jslint
    fudge, node
*/

import {
    pipe
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
import {
    set_timeout,
    set_interval
} from "@jlrwi/functional-timers";
import parseq from "@jlrwi/curried-parseq";

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

const applied_fallback = applied_requestor(parseq.fallback);

const applied_parallel = applied_requestor(parseq.parallel);

const applied_race = applied_requestor(parseq.race);

// Result: <a -> b> -> {a} -> {<a -> b>} -> {b}
const applied_parallel_object = function (options = {}) {
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

const chained_requestor = function ({continuer, aggregator}) {

    if (continuer === undefined) {
        throw "Continuer function missing";
    }

    if (aggregator === undefined) {
        throw "Aggregator function missing";
    }

    return function (requestor) {
        return function chainer_requestor(callback) {
            return function (initial_value) {
                let cancel_function;

                const cancel = function () {
                    if (type_check("function")(cancel_function)) {
                        cancel_function();
                    }
                };

                const chained_callback = function (value, reason) {

                    if (value === undefined) {
                        callback(value, reason);
                        return;
                    }

// Aggregate the values
                    const result = aggregator(initial_value)(value);

// If result passes continuer, spawn another chained_requestor, otherwise return
                    if (continuer(result)) {
                        cancel_function = chained_requestor(
                            {continuer, aggregator}
                        )(
                            requestor
                        )(
                            callback
                        )(
                            result
                        );
                    } else {
                        callback(result);
                    }
                };

                cancel_function = requestor(chained_callback)(initial_value);
                return cancel;
            };
        };
    };
};

const repeat_requestor = function (repeat_predicate) {
    return function (requestor) {
        return function repeater_requestor(callback) {
            return function (initial_value) {
                let cancel_function;

                const cancel = function () {
                    if (type_check("function")(cancel_function)) {
                        cancel_function();
                    }
                };

                const repeater_callback = function (value, reason) {
                    if (value === undefined) {
                        callback(undefined, reason);
                        return;
                    }

// If the returned value passes the predicate function, re-run the requestor
                    if (repeat_predicate(value) === true) {
                        cancel_function = requestor(repeater_callback)(value);

// The returned value failed the predicate - no more repeats, return the value
                    } else {
                        callback(value);
                    }
                };

// Must pass the repeater test initially
                if (repeat_predicate(initial_value) === true) {
                    cancel_function = requestor(
                        repeater_callback
                    )(
                        initial_value
                    );
                    return cancel;
                }

// If fail initial repeater test, return initial value immediately
                callback(initial_value);
            };
        };
    };
};

const constant_requestor = function (constant_value) {
    return function constant_requestor(callback) {
        return function (ignore) {
            callback(constant_value);
        };
    };
};

const promise_requestor = function (promise_object) {
    return function promise_requestor(callback) {
        const on_err = function (err) {
            return callback(undefined, err.message);
        };

        return function (ignore) {
            promise_object().then(callback).catch(on_err);
        };
    };
};

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

const wait_requestor = function ({predicate, args, interval, timeout}) {

    if (!type_check("function")(predicate)) {
        throw "Invalid predicate function";
    }

    if (interval === undefined) {
        throw "No interval value specified";
    }

    return function (callback) {
        return function (value) {
            let cancel_timer;
            let cancel_limit;

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
                    if (cancel_limit !== undefined) {
                        cancel_limit();
                    }

// Shut down the interval timer
                    cancel_timer();

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

                if (cancel_timer !== undefined) {
                    cancel_timer();
                }

                callback(undefined, "Timeout exceeded");
            };

// Start the timer(s)
            try {
                cancel_timer = set_interval(interval)(tester);

                if (type_check("number")(timeout)) {
                    cancel_limit = set_timeout(timeout)(timeout_callback);
                }
            } catch (exception) {
                callback(undefined, exception.message);
                return;
            }

// If user cancels, clear the timeout and interval timers
            return function cancel() {
                if (cancel_limit !== undefined) {
                    cancel_limit();
                }

                if (cancel_timer !== undefined) {
                    cancel_timer();
                }
            };
        };
    };
};

const indexed_requestor = function (options = {}) {
    return function (requestors) {

        if (!Array.isArray(requestors)) {
            throw "Invalid requestors array";
        }

// Make each requestor in the list use value at corresponding index of input
        const index_mapper = function (requestor, index) {
            return function index_requestor(callback) {
                return pipe(
                    prop(index)
                )(
                    functional_if(
                        equals(undefined)
                    )(
// When the input is missing an index, return {}
                        constant_requestor(minimal_object())(callback)
                    )(
// Otherwise call the requestor
                        requestor(callback)
                    )
                );
            };
        };

        return parseq.parallel(
            options
        )(
            requestors.map(index_mapper)
        );
    };
};

const record_requestor = function (options = {}) {
    return function (requestors) {

        if (!is_object(requestors)) {
            throw "Invalid requestors object";
        }

// Turn each key/requestor in the object of requestors into [key, requestor]
// With the corresponding val from input piped into each requestor
        const property_mapper = function (key_val_pair) {
            const [key, requestor] = key_val_pair;

            return [
                key,
                function property_requestor(callback) {
                    return pipe(
                        prop(key)
                    )(
                        functional_if(
                            equals(undefined)
                        )(
// When the input is missing a key, return {}
                            constant_requestor(minimal_object())(callback)
                        )(
// Otherwise call the requestor
                            requestor(callback)
                        )
                    );
                }
            ];
        };

        return parseq.parallel_object(
            options
        )(
            Object.fromEntries(Object.entries(requestors).map(property_mapper))
        );
    };
};

const conditional_requestor = function (error_message = "") {
    return function (predicate) {
        return function conditional_requestor(callback) {
            return function (value) {
                if (predicate(value)) {
                    callback(value);
                } else {
                    callback(
                        undefined,
                        (
                            (error_message.length > 0)
                            ? error_message
                            : "conditional_requestor: value failed predicate"
                        )
                    );
                }
            };
        };
    };
};

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

export {
    applied_race,
    applied_parallel,
    applied_fallback,
    applied_parallel_object,
    chained_requestor,
    conditional_requestor,
    constant_requestor,
    indexed_requestor,
    promise_requestor,
    record_requestor,
    repeat_requestor,
    unary_requestor,
    wait_requestor,
    functional_callback
};
