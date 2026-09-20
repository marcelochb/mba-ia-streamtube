import { ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { appConfig } from '../config/app.config';

/**
 * Every global defense the API runs with.
 *
 * `main.ts` and the e2e suite call this same function, so a test can never
 * pass against a configuration production does not have — reproducing the
 * setup by hand in the suite would assert on a copy, and would keep passing
 * after someone removed a defense from the real bootstrap.
 *
 * Process lifecycle (`enableShutdownHooks`, `listen`) stays in `main.ts`:
 * it is not application configuration and has no place in a test.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  // Security headers first, so they apply to every route including 404s.
  app.use(helmet());

  // Do not advertise the framework to attackers fingerprinting the stack.
  app.disable('x-powered-by');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties with no DTO declaration...
      whitelist: true,
      // ...and reject the request outright when they are present, so unexpected
      // input never reaches the service layer.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Explicit allow-list only — a wildcard origin would let any site issue
  // credentialed requests against the API.
  app.enableCors({
    origin: config.corsOrigin,
    credentials: true,
  });
}
