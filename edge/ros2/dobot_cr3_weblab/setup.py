from setuptools import setup

package_name = 'dobot_cr3_weblab'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages',
         ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', ['launch/weblab.launch.py']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='PRIMBIO',
    maintainer_email='primbio@unal.edu.co',
    description='Web-facing ROS 2 surface for the Dobot CR3 remote lab.',
    license='MIT',
    entry_points={
        'console_scripts': [
            'weblab = dobot_cr3_weblab.node:main',
        ],
    },
)
