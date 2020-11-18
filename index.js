/*jslint
    fudge
*/

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

// Insert a value into an array of requestors
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

export {
    unary_requestor,
    constant_requestor,
    promise_requestor,
    functional_callback
};