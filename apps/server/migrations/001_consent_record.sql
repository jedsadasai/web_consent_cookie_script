-- Consent log. Compatible with SQL Server 2016 (compatibility level 130) and later.
-- Each visitor choice is one immutable row (append-only audit trail).

IF OBJECT_ID(N'dbo.ConsentRecord', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ConsentRecord (
    Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsentRecord PRIMARY KEY CLUSTERED,
    EventId       UNIQUEIDENTIFIER     NOT NULL CONSTRAINT UQ_ConsentRecord_EventId UNIQUE,
    ConsentId     UNIQUEIDENTIFIER     NOT NULL,
    SiteKey       NVARCHAR(64)         NOT NULL,
    SubjectId     NVARCHAR(128)        NULL,
    Action        VARCHAR(16)          NOT NULL
                  CONSTRAINT CK_ConsentRecord_Action CHECK (Action IN ('accept_all', 'reject_all', 'custom', 'withdraw')),
    Necessary     BIT                  NOT NULL,
    Preferences   BIT                  NOT NULL,
    Analytics     BIT                  NOT NULL,
    Marketing     BIT                  NOT NULL,
    PolicyVersion NVARCHAR(32)         NOT NULL,
    Language      VARCHAR(8)           NOT NULL,
    PageUrl       NVARCHAR(2048)       NULL,
    IpTruncated   VARCHAR(45)          NULL,
    IpHash        CHAR(64)             NULL,
    UserAgent     NVARCHAR(512)        NULL,
    CreatedAt     DATETIME2(3)         NOT NULL CONSTRAINT DF_ConsentRecord_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConsentRecord_ConsentId' AND object_id = OBJECT_ID(N'dbo.ConsentRecord'))
  CREATE NONCLUSTERED INDEX IX_ConsentRecord_ConsentId ON dbo.ConsentRecord (ConsentId, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConsentRecord_SubjectId' AND object_id = OBJECT_ID(N'dbo.ConsentRecord'))
  CREATE NONCLUSTERED INDEX IX_ConsentRecord_SubjectId ON dbo.ConsentRecord (SubjectId, CreatedAt DESC)
  WHERE SubjectId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConsentRecord_Site_CreatedAt' AND object_id = OBJECT_ID(N'dbo.ConsentRecord'))
  CREATE NONCLUSTERED INDEX IX_ConsentRecord_Site_CreatedAt ON dbo.ConsentRecord (SiteKey, CreatedAt DESC)
  INCLUDE (Action, Preferences, Analytics, Marketing);
GO
