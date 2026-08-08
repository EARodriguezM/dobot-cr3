"""Launch the web-facing ROS 2 surface for the CR3 remote lab.

Start the driver stack first (dobot_cr3_bringup, then dobot_cr3_moveit for the
gripper action); this node degrades to telemetry-only without them.

    ros2 launch dobot_cr3_weblab weblab.launch.py
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument(
            'log_level', default_value='info',
            description='rclpy logging level for the weblab node'),
        Node(
            package='dobot_cr3_weblab',
            executable='weblab',
            name='weblab',
            output='screen',
            arguments=['--ros-args', '--log-level',
                       LaunchConfiguration('log_level')],
        ),
    ])
