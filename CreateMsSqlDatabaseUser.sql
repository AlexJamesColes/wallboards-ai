-- ============================================================
-- Create Login at the Server Level
-- ============================================================
USE [master];
GO

CREATE LOGIN [AiBoardUser]
    WITH PASSWORD    = N'<ENTER_PRD_HERE>',
    CHECK_POLICY     = ON,
    CHECK_EXPIRATION = ON;
GO


-- ============================================================
-- Create User in the Gecko Database and Assign Permissions
-- ============================================================
USE [Gecko];
GO

CREATE USER [AiBoardUser]
    FOR LOGIN [AiBoardUser]
    WITH DEFAULT_SCHEMA = [dbo];
GO


-- ============================================================
-- Grant SELECT on all existing and future objects in dbo schema
-- ============================================================
GRANT SELECT ON SCHEMA::[dbo] TO [AiBoardUser];
GO


-- ============================================================
-- Explicitly DENY write and structural permissions
-- ============================================================

-- Schema-level data manipulation and execution
DENY INSERT  ON SCHEMA::[dbo] TO [AiBoardUser];
DENY UPDATE  ON SCHEMA::[dbo] TO [AiBoardUser];
DENY DELETE  ON SCHEMA::[dbo] TO [AiBoardUser];
DENY EXECUTE ON SCHEMA::[dbo] TO [AiBoardUser];
DENY ALTER   ON SCHEMA::[dbo] TO [AiBoardUser];
GO

-- Database-level DDL (these are the valid DENY targets at DB scope)
DENY CREATE TABLE     TO [AiBoardUser];
DENY CREATE VIEW      TO [AiBoardUser];
DENY CREATE PROCEDURE TO [AiBoardUser];
DENY CREATE FUNCTION  TO [AiBoardUser];
DENY CREATE RULE      TO [AiBoardUser];
DENY CREATE DEFAULT   TO [AiBoardUser];
DENY CREATE TYPE      TO [AiBoardUser];
DENY CREATE SCHEMA    TO [AiBoardUser];
GO


-- ============================================================
-- Verification query
-- ============================================================
SELECT
    perm.state_desc       AS PermissionState,
    perm.permission_name  AS Permission,
    perm.class_desc       AS OnObjectClass,
    COALESCE(
        SCHEMA_NAME(obj.schema_id) + '.' + obj.name,
        SCHEMA_NAME(sch.schema_id)
    )                     AS OnObject
FROM   sys.database_permissions  perm
LEFT   JOIN sys.objects          obj ON obj.object_id  = perm.major_id
LEFT   JOIN sys.schemas          sch ON sch.schema_id  = perm.major_id
JOIN   sys.database_principals   usr ON usr.principal_id = perm.grantee_principal_id
WHERE  usr.name = N'AiBoardUser'
ORDER  BY PermissionState, Permission;
GO
