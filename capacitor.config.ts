import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.rootedhomeschoolapp.app',
  appName: 'Rooted',
  webDir: 'out',
  server: {
    url: 'https://www.rootedhomeschoolapp.com',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'rootedhomeschoolapp.com',
      'www.rootedhomeschoolapp.com'
    ]
  },
  ios: {
    contentInset: 'always'
  }
};
export default config;
