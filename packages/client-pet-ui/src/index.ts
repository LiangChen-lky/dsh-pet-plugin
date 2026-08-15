/**
 * Companion-pet plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Pet assets arrive over the host pet-assets plugin's HTTP
 * routes, so this half owns no behavior.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
