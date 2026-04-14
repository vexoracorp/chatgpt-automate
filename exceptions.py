"""Project-specific exception hierarchy."""


class AutomateError(Exception):
    """Base exception for chatgpt-automate."""


class NetworkError(AutomateError):
    """Raised when a network request fails."""


class RegionBlockedError(NetworkError):
    """Raised when the IP is in a blocked region (CN, HK, etc.)."""


class OAuthError(AutomateError):
    """Raised when OAuth flow encounters an error."""


class TokenExchangeError(OAuthError):
    """Raised when the authorization code to token exchange fails."""


class CallbackParseError(OAuthError):
    """Raised when the OAuth callback URL cannot be parsed."""


class RegistrationError(AutomateError):
    """Raised when the account registration flow fails."""


class SentinelError(RegistrationError):
    """Raised when the Sentinel challenge fails."""
