import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { appConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  configureApp(app);

  // Close the DB pool on SIGTERM/SIGINT instead of dropping connections.
  app.enableShutdownHooks();

  await app.listen(config.port);
}

void bootstrap();
