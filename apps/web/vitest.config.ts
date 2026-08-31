import react from '@vitejs/plugin-react';

import { defineJobRadarTestConfig } from '@job-radar/testing';

export default defineJobRadarTestConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
