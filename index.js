/*jslint
    fudge, node
*/

import {
    compose
} from "@jlrwi/combinators";
import {
    is_object,
    array_map,
    object_map,
    prop,
    type_check
} from "@jlrwi/esfunctions";
import parseq from "@jlrwi/parseq";

const unary_requestor = function (unary_fx) {
    return function unary_requestor (callback) {
        return function (value) {
            try {
                callback (unary_fx (value));
            } catch (err) {
                callback (undefined, err.message);
            }
        };
    };
};

// Can be used to insert a value into a sequence of requestors
const constant_requestor = function (constant_value) {
    return function constant_requestor (callback) {
        return function (ignore) {
            return callback (constant_value);
        };
    };
};

// Convert a promise to a requestor
const promise_requestor = function (promise_object) {
    return function promise_requestor (callback) {
        const on_err = function (err) {
            return callback(undefined, err.message);
        };

        return function (ignore) {
            promise_object.then(callback).catch(on_err);
        };
    };
};

const functional_callback = function (on_success) {
    return function (on_fail) {
        return function callback (value, reason) {
            if (value === undefined) {
                on_fail (reason);
            } else {
                on_success (value);
            }
        };
    };
};

const wait_requestor = function (callback) {
    return function ({predicate, args, interval, timeout, value}) {
        let timer;
        let limit;

        if (value === undefined) {
            value = Date.now;
        }

        const tester = function () {
            const result = (
                (Array.isArray(args))
                ? predicate(...args)
                : predicate(args)
            );

            if (result === true) {
                clearInterval(timer);
                if (limit) {
                    clearTimeout(limit);
                }
                timer = undefined;
                callback(
                    (type_check ("function") (value))
                    ? value ()
                    : value
                );
            }
        };

        const timeout_callback = function () {
            clearInterval(timer);
            timeout = undefined;
            limit = undefined;
            callback(undefined, "Timeout exceeded");
        };

        try {
            timer = setInterval(tester, interval);
            if (type_check ("number") (timeout)) {
                limit = setTimeout(timeout_callback, timeout);
            }
        } catch (exception) {
            callback(undefined, exception.message);
            return;
        }

        return function () {
            clearInterval(timer);
        };
    };
};

// Take an object of requestors and send them the matching properties from the
// input object
const record_requestor = function (requestors) {

    if (!is_object(requestors)) {
        throw "Invalid requestors object.";
    }

    const requestor_list = Object.keys(requestors).map(
        function (key) {
            return [
                key,
                function requestor (callback) {
                    return compose (requestors[key](callback)) (prop (key));
                }
            ];
        }
    );

    return parseq.parallel_object () (Object.fromEntries(requestor_list));
};

// Take a requestor and input value, and return a requestor that takes a
// callback but ignores the normal initial_value parameter
const preloaded_requestor = function (requestor) {
    return function (input) {
        return function derived_requestor(callback) {
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

                    const requestor_list = array_map(
                        preloaded_requestor(requestor)
                    )(
                        input_list
                    );

                    return processor(
                        options
                    )(
                        requestor_list
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
// Result: <a -> b> -> {a} -> [<a -> b>] -> {b}
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

const repeat_requestor = function (repeat_predicate) {
    return function (requestor) {
        return function repeater_requestor (callback) {
            return function (initial_value) {

                const repeater_callback = function (value, reason) {
                    if (value === undefined) {
                        callback(undefined, reason);
                        return;
                    }

// If the returned value passes the predicate function, re-run the requestor
                    if (repeat_predicate (value) === true) {
                        requestor (repeater_callback) (value);

// The returned value failed the predicate - no more repeats, return the value
                    } else {
                        callback(value);
                    }
                };

                // Must pass the repeater test initially
                if (repeat_predicate (initial_value) === true) {
                    requestor (repeater_callback) (initial_value);
                } else {
                    callback(initial_value);
                }
            };
        };
    };
};

const chained_requestor = function ({continuer, aggregator}) {

    if (continuer === undefined) {
        throw "Continuer function missiing";
    }

    if (aggregator === undefined) {
        throw "Aggregator function missing";
    }

    return function (requestor) {
        return function chained_requestor (callback) {
            return function (initial_value) {
                const chained_callback = function (value, reason) {
                    if (value === undefined) {
                        callback(value, reason);
                        return;
                    }

                    const result = aggregator (initial_value) (value);

                    const f = (
                        continuer(result)
                        ? chained_requestor (
                            {continuer, aggregator}
                        ) (
                            requestor
                        ) (
                            callback
                        )
                        : callback
                    );

                    f (result);
                };

                return requestor (chained_callback) (initial_value);
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
    repeat_requestor,
    record_requestor,
    wait_requestor
};