-- Full client IP (as resolved by TRUST_PROXY), stored next to the truncated IP and its HMAC.
-- VARCHAR(45) fits the longest textual IPv6 form. SQL Server 2016 (compatibility level 130) compatible.

IF COL_LENGTH(N'dbo.ConsentRecord', N'IpAddress') IS NULL
  ALTER TABLE dbo.ConsentRecord ADD IpAddress VARCHAR(45) NULL;
GO
