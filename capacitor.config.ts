import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.rootedhomeschoolapp.app',
  appName: 'Rooted',
  webDir: 'out',
  server: {
    url: 'https://rootedhomeschoolapp.com',
    cleartext: false,
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'always'
  }
};
export default config;
