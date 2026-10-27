-- Least-privilege login for the API (run once as a DBA on SQL Server 2016+).
-- The API only needs to INSERT consent rows and run `SELECT 1` for readiness.
-- Replace the database name and the password before running.

USE [master];
GO
IF SUSER_ID(N'consent_app') IS NULL
  CREATE LOGIN [consent_app] WITH PASSWORD = N'<strong-random-password>', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
GO

USE [ConsentDB];
GO
IF DATABASE_PRINCIPAL_ID(N'consent_app') IS NULL
  CREATE USER [consent_app] FOR LOGIN [consent_app];
GO
GRANT INSERT, SELECT ON dbo.ConsentRecord TO [consent_app];
GO
