function fatal
{
    echo "$0: fatal error: $*" >&2
    exit 1
}

function errexit
{
    [[ $1 -ne 0 ]] || exit 0
    fatal "error exit status $1"
}
