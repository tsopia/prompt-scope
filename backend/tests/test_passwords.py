from services.passwords import hash_password, verify_password


def test_hash_and_verify_password():
    h = hash_password("s3cret-pw")
    assert h != "s3cret-pw"
    assert verify_password("s3cret-pw", h) is True
    assert verify_password("wrong", h) is False
