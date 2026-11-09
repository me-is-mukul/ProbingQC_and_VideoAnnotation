"""IMU extraction: GPMF telemetry -> accelerometer/gyroscope table.

Stages (each module is usable and testable on its own):

    telemetry  find and copy the GPMF track out of the MP4 (FFmpeg)
    gpmf       parse the KLV byte structure
    sensor     decode one sensor: scale, axis order, timestamps
    table      merge ACCL + GYRO into one DataFrame, summarise, write CSV
    checks     physical sanity checks on the result
"""

from .checks import Check, ImuLimits, check_imu
from .gpmf import KLV, iter_klv
from .sensor import SensorStream, extract_sensor, payload_timestamps, to_xyz
from .table import IMU_COLUMNS, extract_imu, imu_dataframe, imu_summary, write_imu_csv
from .telemetry import find_gpmf_index, find_gpmf_stream, read_gpmf

__all__ = [
    "IMU_COLUMNS", "KLV", "Check", "ImuLimits", "SensorStream",
    "check_imu", "extract_imu", "extract_sensor", "find_gpmf_index", "find_gpmf_stream",
    "imu_dataframe", "imu_summary", "iter_klv", "payload_timestamps", "read_gpmf",
    "to_xyz", "write_imu_csv",
]
