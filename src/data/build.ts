/** What this build is. Shown in the app and compared with /version.json and app_config. */
export const build = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  demo: __APP_DEMO__,
} as const;
