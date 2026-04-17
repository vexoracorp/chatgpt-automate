from tortoise import fields, models


class Account(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    email = fields.CharField(max_length=255)
    status = fields.CharField(max_length=255, default="pending")
    proxy_url = fields.TextField(null=True)
    session_token = fields.TextField(null=True)
    access_token = fields.TextField(null=True)
    codex_token = fields.TextField(null=True)
    name = fields.CharField(max_length=255, default="")
    plan = fields.CharField(max_length=50, default="")
    plan_expiry = fields.CharField(max_length=50, default="")
    codex_weekly_used = fields.FloatField(default=0)
    codex_weekly_reset_hours = fields.IntField(default=0)
    codex_5h_used = fields.FloatField(default=0)
    codex_5h_reset_min = fields.IntField(default=0)
    password = fields.CharField(max_length=255, default="")
    cookies = fields.TextField(null=True)
    created_at = fields.CharField(max_length=30, default="")
    last_login = fields.CharField(max_length=30, null=True)

    class Meta:
        table = "accounts"


class User(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    email = fields.CharField(max_length=255, unique=True)
    name = fields.CharField(max_length=255, default="")
    role = fields.CharField(max_length=20, default="user")
    password_hash = fields.CharField(max_length=64)
    totp_secret = fields.CharField(max_length=64, null=True)
    totp_enabled = fields.BooleanField(default=False)
    password_changed_at = fields.CharField(max_length=30, null=True)
    last_login = fields.CharField(max_length=30, null=True)
    created_at = fields.CharField(max_length=30, default="")

    class Meta:
        table = "users"


class Proxy(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    protocol = fields.CharField(max_length=20)
    host = fields.CharField(max_length=255)
    port = fields.IntField()
    username = fields.CharField(max_length=255, default="")
    password = fields.CharField(max_length=255, default="")
    label = fields.CharField(max_length=255, default="")
    group = fields.CharField(max_length=255, default="")
    subscription_id = fields.CharField(max_length=8, null=True)
    node_index = fields.IntField(null=True)
    url = fields.TextField(default="")
    created_at = fields.CharField(max_length=30, default="")
    last_test = fields.JSONField(null=True)

    class Meta:
        table = "proxies"


class Subscription(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    name = fields.CharField(max_length=255)
    url = fields.TextField()
    resolved_url = fields.TextField(default="")
    nodes = fields.JSONField(default=[])
    metadata_ = fields.JSONField(default={})
    updated_at = fields.CharField(max_length=30, default="")

    class Meta:
        table = "subscriptions"


class Mailbox(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    email = fields.CharField(max_length=255)
    password = fields.CharField(max_length=255, default="")
    refresh_token = fields.TextField(default="")
    client_id = fields.CharField(max_length=255, default="")
    status = fields.CharField(max_length=20, default="available")
    assigned_account_id = fields.CharField(max_length=8, null=True)
    created_at = fields.CharField(max_length=30, default="")

    class Meta:
        table = "mailboxes"


class Settings(models.Model):
    id = fields.IntField(primary_key=True, default=1)
    org_name = fields.CharField(max_length=255, default="ChatGPT Account Manager")
    allowed_ips = fields.JSONField(default=[])
    require_2fa = fields.BooleanField(default=False)
    allow_email_change = fields.BooleanField(default=False)
    allow_password_change = fields.BooleanField(default=True)
    password_expiry_days = fields.IntField(default=0)
    session_timeout_min = fields.IntField(default=0)

    class Meta:
        table = "settings"


class ApiKey(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    name = fields.CharField(max_length=255)
    key_hash = fields.CharField(max_length=64)
    key_prefix = fields.CharField(max_length=8)
    user_id = fields.CharField(max_length=8)
    created_at = fields.CharField(max_length=30, default="")
    last_used = fields.CharField(max_length=30, null=True)

    class Meta:
        table = "api_keys"


class OutlookConfig(models.Model):
    id = fields.IntField(primary_key=True, default=1)
    tenant_id = fields.CharField(max_length=255, default="")
    client_id = fields.CharField(max_length=255, default="")
    client_secret = fields.CharField(max_length=255, default="")

    class Meta:
        table = "outlook_config"


class CdkProvider(models.Model):
    id = fields.CharField(max_length=8, primary_key=True)
    name = fields.CharField(max_length=100)
    provider_type = fields.CharField(max_length=50)
    base_url = fields.CharField(max_length=500)
    auth_type = fields.CharField(max_length=20, default="none")
    auth_value = fields.CharField(max_length=500, default="")
    is_enabled = fields.BooleanField(default=True)
    settings = fields.JSONField(null=True)
    created_at = fields.CharField(max_length=30, default="")

    class Meta:
        table = "cdk_providers"
