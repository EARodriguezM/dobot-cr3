#!/usr/bin/env python3
"""Prove the robot answers the lab computer and nobody else.

The Dobot's TCP protocol takes no credentials, so the only thing that decides
who may command the arm is who can open a socket to it. That is a network
property, and network properties rot quietly: a robot moved to another bench, a
cable in the wrong switch port, a DHCP lease that came back on the campus range.
Nothing in the platform notices, because none of it is in the path.

So this asks the question directly, from both sides:

    # on the lab computer, where the answer must be yes
    ./verify-robot-isolation.py --role lab --robot 192.168.5.1

    # on any other machine on the campus network, where it must be no
    ./verify-robot-isolation.py --role outsider --robot 192.168.5.1

Read-only by construction: it opens TCP connections and closes them without
sending a byte. It never speaks the Dobot protocol, because a stray payload on
port 29999 or 30003 moves a real arm.

See docs/robot-network.md for the topologies this is meant to verify.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys

# 29999 dashboard (enable, clear error), 30003 motion, 30004 real-time feed.
# The first two are the ones that move the arm; all three are checked because
# any of them answering means the host is reachable.
VENDOR_PORTS = (29999, 30003, 30004)
CONNECT_TIMEOUT_S = 2.0

GREEN, RED, YELLOW, DIM, RESET = (
    ('\033[32m', '\033[31m', '\033[33m', '\033[2m', '\033[0m')
    if sys.stdout.isatty() else ('', '', '', '', '')
)


def reachable(host: str, port: int) -> bool:
    """One TCP handshake, then close. Nothing is sent."""
    s = socket.socket()
    s.settimeout(CONNECT_TIMEOUT_S)
    try:
        s.connect((host, port))
        return True
    except Exception:
        return False
    finally:
        s.close()


def route_to(host: str) -> tuple[str, str]:
    """(interface, source address) the kernel would use, or ('', '')."""
    try:
        out = subprocess.run(
            ['ip', '-o', 'route', 'get', host],
            capture_output=True, text=True, timeout=5).stdout.split()
    except Exception:
        return '', ''
    dev = out[out.index('dev') + 1] if 'dev' in out else ''
    src = out[out.index('src') + 1] if 'src' in out else ''
    return dev, src


def default_interfaces() -> set[str]:
    """Interfaces carrying a default route — i.e. facing the wider network."""
    try:
        out = subprocess.run(
            ['ip', '-o', 'route', 'show', 'default'],
            capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return set()
    found = set()
    for line in out.splitlines():
        parts = line.split()
        if 'dev' in parts:
            found.add(parts[parts.index('dev') + 1])
    return found


def check_lab(robot: str) -> int:
    """On the lab computer the robot must be reachable, and on a link that goes
    nowhere else."""
    problems = []
    dev, src = route_to(robot)
    print(f'route to {robot}: {DIM}dev={dev or "?"} src={src or "?"}{RESET}')

    open_ports = [p for p in VENDOR_PORTS if reachable(robot, p)]
    if not open_ports:
        print(f'{RED}FAIL{RESET} the robot does not answer at all. The driver '
              f'cannot work either — check power, cabling and the address.')
        return 1
    print(f'{GREEN} ok {RESET} the robot answers on {", ".join(map(str, open_ports))}')

    if not dev:
        problems.append('no route to the robot could be determined')
    elif dev in default_interfaces():
        problems.append(
            f'the robot is reached over {dev}, which also carries the default '
            f'route. That is a shared network: every other host on it can '
            f'command the arm. This is the condition robot-network.md exists '
            f'to remove.')

    for problem in problems:
        print(f'{RED}FAIL{RESET} {problem}')
    if problems:
        return 1
    print(f'{GREEN} ok {RESET} {dev} carries no default route, so it is a '
          f'dedicated link')
    print(f'\n{GREEN}The lab computer can drive the robot over a private '
          f'link.{RESET}')
    print(f'{YELLOW}This half proves only that the platform still works. Run '
          f'--role outsider from another machine to prove anyone else '
          f'cannot.{RESET}')
    return 0


def check_outsider(robot: str, assume_up: bool) -> int:
    """From anywhere else, every vendor port must be unreachable."""
    open_ports = [p for p in VENDOR_PORTS if reachable(robot, p)]
    if open_ports:
        print(f'{RED}FAIL{RESET} this machine reached the robot on '
              f'{", ".join(map(str, open_ports))}.')
        print('      Anyone here can enable and move the arm without a '
              'session, a role or the control lease.')
        return 1

    print(f'{GREEN} ok {RESET} no vendor port answered from this machine')
    if not assume_up:
        print(f'\n{YELLOW}Not proof on its own.{RESET} A robot that is powered '
              f'off is unreachable from everywhere, including the lab '
              f'computer.')
        print('Confirm the arm is powered and that --role lab passes on the '
              'lab computer right now, then re-run with --robot-is-up.')
        return 2
    print(f'\n{GREEN}The robot is isolated: reachable from the lab computer, '
          f'not from here.{RESET}')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Check who can reach the robot\'s unauthenticated TCP ports.')
    parser.add_argument(
        '--robot', default=os.environ.get('IP_address', ''),
        help='robot controller address (default: $IP_address)')
    parser.add_argument(
        '--role', choices=('lab', 'outsider'), required=True,
        help='lab: this is the computer running the driver, where the robot '
             'must be reachable. outsider: any other machine, where it must '
             'not be.')
    parser.add_argument(
        '--robot-is-up', action='store_true',
        help='confirm the robot is powered on and reachable from the lab '
             'computer, so an unreachable result here means isolation rather '
             'than a robot that is switched off.')
    args = parser.parse_args()

    if not args.robot:
        parser.error('no robot address: pass --robot or set IP_address')

    print(f'{DIM}Connect-only probe of {args.robot} on '
          f'{", ".join(map(str, VENDOR_PORTS))}. Nothing is sent.{RESET}\n')
    if args.role == 'lab':
        return check_lab(args.robot)
    return check_outsider(args.robot, args.robot_is_up)


if __name__ == '__main__':
    sys.exit(main())
