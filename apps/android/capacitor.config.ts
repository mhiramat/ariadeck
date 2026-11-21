import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Ariadeck Android mobile application.
 * Customize appId (io.github.<username>.ariadeck) before publishing builds.
 */
const config: CapacitorConfig = {
  appId: 'io.github.example.ariadeck',
  appName: 'Ariadeck',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
