"""NWS feels-like temperature: heat index and wind chill. All temperatures in °F.

Works on scalars and numpy arrays. Following the plan, "feels like" never moves the
temperature the comfortable way: heat only raises it, wind only lowers it.
"""
import numpy as np


def relative_humidity(t, td):
    """Relative humidity (%) from air temperature and dew point (°F), Magnus formula."""
    tc, tdc = (np.asarray(t) - 32) * 5 / 9, (np.asarray(td) - 32) * 5 / 9
    es = lambda c: np.exp(17.625 * c / (243.04 + c))
    return np.clip(100 * es(tdc) / es(tc), 0, 100)


def heat_index(t, rh):
    """NWS heat index (°F) from temperature (°F) and relative humidity (%).

    https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
    """
    t, rh = np.asarray(t, dtype=float), np.asarray(rh, dtype=float)
    simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094)
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh
          - 0.00683783 * t * t - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
          + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh)
    dry = (rh < 13) & (t >= 80) & (t <= 112)
    hi = hi - np.where(dry, (13 - rh) / 4 * np.sqrt(np.clip(17 - np.abs(t - 95), 0, None) / 17), 0)
    humid = (rh > 85) & (t >= 80) & (t <= 87)
    hi = hi + np.where(humid, (rh - 85) / 10 * (87 - t) / 5, 0)
    return np.where((simple + t) / 2 >= 80, hi, simple)


def wind_chill(t, mph):
    """NWS wind chill (°F), defined for t <= 50°F and wind >= 3 mph; otherwise t.

    https://www.weather.gov/media/epz/wxcalc/windChill.pdf
    """
    t, mph = np.asarray(t, dtype=float), np.asarray(mph, dtype=float)
    v = np.power(np.clip(mph, 0, None), 0.16)
    wc = 35.74 + 0.6215 * t - 35.75 * v + 0.4275 * t * v
    return np.where((t <= 50) & (mph >= 3), wc, t)


def feels_high(tmax, dewpt):
    """Daytime feels-like: heat index from the daily max and the daily mean dew point."""
    return np.maximum(tmax, heat_index(tmax, relative_humidity(tmax, dewpt)))


def feels_low(tmin, mph):
    """Overnight feels-like: wind chill from the daily min and the daily mean wind."""
    return np.minimum(tmin, wind_chill(tmin, mph))
