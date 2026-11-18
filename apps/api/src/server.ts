import { createApp } from './app.js';
import { env } from './env.js';
import { repairInterruptedRuns } from './services/runs.js';

const app = createApp();

repairInterruptedRuns();

app.listen(env.port, () => {
  console.log(`Buxgalter RPA API: http://localhost:${env.port}/api`);
  console.log(`Ma’lumot papkasi: ${env.dataDir}`);
});
