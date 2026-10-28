import numpy as np
import pytest

from feelslike import feels_high, feels_low, heat_index, relative_humidity, wind_chill

# (°F, RH %, NWS heat index chart value)
HEAT_INDEX_CHART = [
    (80, 40, 80),
    (90, 50, 95),
    (86, 90, 105),
    (96, 65, 121),
    (100, 40, 109),
    (104, 55, 137),
]

# (°F, mph, NWS wind chill chart value)
WIND_CHILL_CHART = [
    (40, 5, 36),
    (30, 10, 21),
    (0, 15, -19),
    (-10, 20, -35),
    (-20, 40, -57),
    (-25, 40, -64),
]


@pytest.mark.parametrize("t, rh, expected", HEAT_INDEX_CHART)
def test_heat_index_matches_nws_chart(t, rh, expected):
    assert round(float(heat_index(t, rh))) == pytest.approx(expected, abs=1)


@pytest.mark.parametrize("t, mph, expected", WIND_CHILL_CHART)
def test_wind_chill_matches_nws_chart(t, mph, expected):
    assert round(float(wind_chill(t, mph))) == expected


def test_wind_chill_undefined_when_warm_or_calm():
    assert wind_chill(60, 20) == 60
    assert wind_chill(20, 2) == 20


def test_relative_humidity():
    assert relative_humidity(68, 68) == pytest.approx(100)
    assert relative_humidity(86, 60) == pytest.approx(42, abs=1)


def test_feels_high_never_below_actual_in_dry_heat():
    # Denver-like: 89°F with a 43°F dew point; the raw heat index is ~86.
    assert feels_high(89, 43) == 89


def test_feels_high_humid():
    # Houston-like: 92°F with a 76°F dew point feels well over 100.
    assert feels_high(92, 76) > 100


def test_feels_low_never_above_actual():
    assert feels_low(70, 25) == 70
    assert feels_low(10, 15) < 10


def test_vectorized():
    out = feels_high(np.array([70, 95]), np.array([50, 75]))
    assert out.shape == (2,) and out[0] == 70 and out[1] > 95
