import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { validationSchema } from './config/validation.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      validationSchema,
      validationOptions: {
        // Joi >= 18 implements Standard Schema: library settings must be nested
        // under `libraryOptions`. The flat form is silently ignored.
        libraryOptions: {
          // Report every invalid variable in one boot, not one per attempt.
          abortEarly: false,
          allowUnknown: true,
        },
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres' as const,
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.name,
        autoLoadEntities: true,
        // Hardcoded false in every environment — migrations are the only
        // sanctioned path for schema change.
        synchronize: false,
        migrationsTableName: 'migrations',
        retryAttempts: 3,
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
