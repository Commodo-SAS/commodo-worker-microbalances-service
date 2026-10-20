/** Bundle and transpile the TypeScript sources published by shared-libs. */
module.exports = function (options) {
    const nodeExternal = Array.isArray(options.externals) ? options.externals[0] : options.externals;

    options.externals = [
        (ctx, callback) => {
            const { request } = ctx;
            if (request && (request === '@commodo-sas/shared-libs' || request.startsWith('@commodo-sas/shared-libs/'))) {
                return callback();
            }
            if (typeof nodeExternal === 'function') return nodeExternal(ctx, callback);
            return callback();
        },
    ];

    const sharedLibsPattern = /@commodo-sas[\\/]+shared-libs/;
    options.module.rules.forEach((rule) => {
        if (!rule.test || !rule.test.toString().includes('tsx')) return;

        const previousExclude = rule.exclude;
        rule.exclude = (modulePath) => {
            if (sharedLibsPattern.test(modulePath)) return false;
            if (typeof previousExclude === 'function') return previousExclude(modulePath);
            if (previousExclude instanceof RegExp) return previousExclude.test(modulePath);
            return /node_modules/.test(modulePath);
        };
    });

    return options;
};
