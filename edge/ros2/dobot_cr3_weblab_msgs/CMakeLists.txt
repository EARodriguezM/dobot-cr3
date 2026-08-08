cmake_minimum_required(VERSION 3.8)
project(dobot_cr3_weblab_msgs)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "srv/Jog.srv"
  "srv/SetSpeed.srv"
  "srv/JointMove.srv"
  "srv/CartMove.srv"
  "srv/Gripper.srv"
  "srv/RunProgram.srv"
)

ament_package()
